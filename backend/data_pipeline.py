"""DisasterIQ data pipeline: fetch, clean and store historical disaster impact.

Run:
    python -m backend.data_pipeline              # download what is missing, rebuild
    python -m backend.data_pipeline --refresh    # re-download every source
    python -m backend.data_pipeline --verify     # print known-event sanity checks

Three stages, each writing to its own folder so a stage can be re-run alone:

1. **fetch** to ``backend/data/raw/`` (git-ignored): the untouched downloads.
2. **clean** to ``backend/data/clean/`` (committed): small, tidy CSVs with
   derived fields. The app and the test suite read only these, so neither
   needs the network.
3. **store** to ``backend/data/disasters.db`` (git-ignored): SQLite built from
   ``clean/`` in about a second; rebuilt automatically at startup if missing.

Sources and what each one feeds are documented in ``docs/DATA_SOURCES.md``.
Nothing here estimates or imputes a value: a figure a source does not report
stays missing.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import logging
import math
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

from backend import disaster_types
from backend.config import DATA_DIR, get_settings

logger = logging.getLogger("disasteriq.pipeline")

RAW_DIR = DATA_DIR / "raw"
CLEAN_DIR = DATA_DIR / "clean"
FRONTEND_GEO = DATA_DIR.parent.parent / "frontend" / "public" / "geo" / "countries-110m.json"

OWID_YEARLY_URL = (
    "https://catalog.ourworldindata.org/explorers/emdat/latest/"
    "natural_disasters/natural_disasters_yearly.csv"
)
OWID_EVENTS_URL = (
    "https://ourworldindata.org/grapher/number-of-natural-disaster-events.csv"
    "?v=1&csvType=full&useColumnShortNames=true"
)
OWID_CODES_URL = (
    "https://ourworldindata.org/grapher/number-of-deaths-from-natural-disasters.csv"
    "?v=1&csvType=full&useColumnShortNames=true"
)
USGS_QUERY_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"
#: World Bank WDI PA.NUS.FCRF: official exchange rate, rupees per US$, annual
#: period average (IMF International Financial Statistics). Used only to show
#: money in ₹ at each record's year; stored figures stay in US$.
WB_INR_URL = "https://api.worldbank.org/v2/country/IND/indicator/PA.NUS.FCRF?format=json&per_page=200"
IBTRACS_URL = (
    "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/"
    "v04r01/access/csv/ibtracs.since1980.list.v04r01.csv"
)
NE_50M_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/"
    "geojson/ne_50m_admin_0_countries.geojson"
)
NE_110M_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/"
    "geojson/ne_110m_admin_0_countries.geojson"
)

#: USGS catalogue threshold. M6+ is the conventional "strong" cut-off and keeps
#: the point layer to ~14k events since 1900.
USGS_MIN_MAGNITUDE = 6.0
USGS_FIRST_YEAR = 1900
#: IBTrACS: the since-1980 file covers the satellite era, when every basin was
#: observed consistently. Earlier tracks exist but are patchy, and NCEI serves
#: the full archive too slowly to fetch reliably.
IBTRACS_FIRST_SEASON = 1980
#: A storm enters the cyclone table if it reached tropical-storm strength.
TROPICAL_STORM_KT = 34

#: OWID rows that are regions or income groups, not countries.
OWID_AGGREGATE_PREFIX = "OWID_"
OWID_HISTORICAL_STATES = {
    "OWID_CZS", "OWID_GDR", "OWID_GFR", "OWID_SRM", "OWID_USS",
    "OWID_YAR", "OWID_YPR", "OWID_YGS", "ANT",
}
#: OWID ISO3 → Natural Earth ADM0_A3 where the two disagree.
NE_CODE_ALIASES = {"PSE": "PSX", "SSD": "SDS"}

#: Metric name in the clean table → OWID column stem (``<stem>_<owid_key>``).
#: Money columns use OWID's US-CPI-adjusted series (constant 2024 US$). OWID's
#: ``*_constant_usd`` series is NOT used: it deflates with local-currency
#: deflators and produces impossible values for high-inflation countries
#: (Venezuela 1999 floods: US$4.5e22; Iran 1990 earthquake: US$14.6 trillion).
IMPACT_METRICS: dict[str, str] = {
    "deaths": "deaths",
    "injured": "injured",
    "affected": "affected",
    "homeless": "homeless",
    "total_affected": "total_affected",
    "damages_usd": "total_damages_adjusted",
    "insured_usd": "insured_damages_adjusted",
    "reconstruction_usd": "reconstruction_costs_adjusted",
    "damages_pct_gdp": "total_damages_pct_gdp",
    # As reported at the time (nominal US$ of the event year). These are the
    # figures converted to ₹ with that year's exchange rate for display; the
    # CPI-adjusted columns above remain the basis of every comparison.
    "damages_nominal_usd": "total_damages",
    "insured_nominal_usd": "insured_damages",
    "reconstruction_nominal_usd": "reconstruction_costs",
}
#: Severity Index weights (documented in docs/DATA_SOURCES.md).
SEVERITY_WEIGHTS = {"deaths": 0.5, "total_affected": 0.25, "damages_usd": 0.25}

HTTP_HEADERS = {"User-Agent": "DisasterIQ data pipeline (research; contact via repository)"}


def use_system_trust_store() -> None:
    """Verify TLS against the OS certificate store when ``truststore`` is installed.

    Needed behind TLS-inspecting proxies, where Python's bundled CA list does
    not include the proxy's root certificate. Without the package, the default
    store is used.
    """
    try:
        import truststore  # type: ignore

        truststore.inject_into_ssl()
    except ImportError:  # pragma: no cover - optional dependency
        pass


# ── fetch ──────────────────────────────────────────────────────────────────
def _download_ranges(url: str, dest: Path, size: int, parts: int) -> None:
    """Parallel HTTP range download; NCEI throttles each connection to ~10 KB/s."""
    chunk = math.ceil(size / parts)
    tmp_dir = dest.with_suffix(dest.suffix + ".parts")
    tmp_dir.mkdir(exist_ok=True)

    def fetch_part(index: int) -> Path:
        """Stream one byte range to disk; a retry resumes where the last attempt stopped."""
        start = index * chunk
        end = min(size, start + chunk) - 1
        path = tmp_dir / f"{index:04d}"
        expected = end - start + 1
        for attempt in range(20):
            have = path.stat().st_size if path.exists() else 0
            if have == expected:
                return path
            try:
                with httpx.Client(timeout=60, headers=HTTP_HEADERS, follow_redirects=True) as client:
                    with client.stream("GET", url, headers={"Range": f"bytes={start + have}-{end}"}) as response:
                        if response.status_code != 206:
                            raise OSError(f"range {index}: HTTP {response.status_code}")
                        with path.open("ab") as out:
                            for block in response.iter_bytes(64 * 1024):
                                out.write(block)
            except (httpx.HTTPError, OSError) as exc:
                logger.warning("range %s attempt %s: %s", index, attempt + 1, exc)
                time.sleep(min(30, 2 + attempt * 2))
        raise RuntimeError(f"could not download range {index} of {url}")

    def report() -> None:
        while not done:
            got = sum(p.stat().st_size for p in tmp_dir.iterdir())
            logger.info("  %s: %.1f / %.1f MB", dest.name, got / 1e6, size / 1e6)
            for _ in range(30):
                if done:
                    return
                time.sleep(1)

    done = False
    with ThreadPoolExecutor(max_workers=parts + 1) as pool:
        pool.submit(report)
        try:
            paths = list(pool.map(fetch_part, range(parts)))
        finally:
            done = True
    with dest.open("wb") as out:
        for path in paths:
            out.write(path.read_bytes())
    for path in paths:
        path.unlink()
    tmp_dir.rmdir()


def download(url: str, dest: Path, *, refresh: bool = False, parts: int = 1,
             params: dict | None = None, timeout: float = 180) -> Path:
    """Download ``url`` to ``dest`` unless it is already cached."""
    if dest.exists() and dest.stat().st_size > 0 and not refresh:
        logger.info("cached   %s", dest.name)
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    if parts > 1:
        with httpx.Client(timeout=60, headers=HTTP_HEADERS, follow_redirects=True) as client:
            head = client.head(url)
            head.raise_for_status()
            size = int(head.headers.get("content-length", 0))
            ranged = head.headers.get("accept-ranges", "").lower() == "bytes"
        if size and ranged:
            _download_ranges(url, dest, size, parts)
            logger.info("fetched  %s (%.1f MB, %.0fs)", dest.name, size / 1e6, time.perf_counter() - started)
            return dest
    with httpx.Client(timeout=timeout, headers=HTTP_HEADERS, follow_redirects=True) as client:
        response = client.get(url, params=params)
        response.raise_for_status()
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        tmp.write_bytes(response.content)
        tmp.replace(dest)
    logger.info("fetched  %s (%.1f MB, %.0fs)", dest.name, dest.stat().st_size / 1e6,
                time.perf_counter() - started)
    return dest


def usgs_decades(last_year: int) -> list[tuple[int, int]]:
    """Decade windows for the USGS query (each under the 20,000-row API limit)."""
    return [(start, min(start + 9, last_year)) for start in range(USGS_FIRST_YEAR, last_year + 1, 10)]


def fetch_all(refresh: bool = False, last_year: int | None = None) -> dict[str, Path | list[Path]]:
    """Fetch every source into ``RAW_DIR``; returns the local paths."""
    last_year = last_year or datetime.now(timezone.utc).year - 1
    paths: dict[str, Path | list[Path]] = {
        "owid_yearly": download(OWID_YEARLY_URL, RAW_DIR / "owid_natural_disasters_yearly.csv", refresh=refresh),
        "owid_yearly_meta": download(OWID_YEARLY_URL.replace(".csv", ".meta.json"),
                                     RAW_DIR / "owid_natural_disasters_yearly.meta.json", refresh=refresh),
        "owid_events": download(OWID_EVENTS_URL, RAW_DIR / "owid_number_of_events.csv", refresh=refresh),
        "owid_codes": download(OWID_CODES_URL, RAW_DIR / "owid_deaths_with_codes.csv", refresh=refresh),
        "ne_50m": download(NE_50M_URL, RAW_DIR / "ne_50m_admin_0_countries.geojson", refresh=refresh),
        "ne_110m": download(NE_110M_URL, RAW_DIR / "ne_110m_admin_0_countries.geojson", refresh=refresh),
        "fx_inr": download(WB_INR_URL, RAW_DIR / "worldbank_inr_per_usd.json", refresh=refresh),
        "ibtracs": download(IBTRACS_URL, RAW_DIR / "ibtracs.since1980.list.v04r01.csv",
                            refresh=refresh, parts=32),
    }
    usgs: list[Path] = []
    for start, end in usgs_decades(last_year):
        usgs.append(download(
            USGS_QUERY_URL,
            RAW_DIR / f"usgs_m{USGS_MIN_MAGNITUDE:g}_{start}_{end}.csv",
            refresh=refresh,
            params={
                "format": "csv",
                "starttime": f"{start}-01-01",
                "endtime": f"{end + 1}-01-01",
                "minmagnitude": USGS_MIN_MAGNITUDE,
                "eventtype": "earthquake",
                "orderby": "time-asc",
                "limit": 20000,
            },
        ))
    paths["usgs"] = usgs
    return paths


# ── clean ──────────────────────────────────────────────────────────────────
def last_complete_year(max_year: int, today: datetime | None = None) -> int:
    """The latest year that is over: the running year is always partial."""
    today = today or datetime.now(timezone.utc)
    return min(max_year, today.year - 1)


def owid_codes(codes_csv: Path) -> pd.DataFrame:
    """OWID entity name → code, with a kind: country, historical_state, aggregate."""
    frame = pd.read_csv(codes_csv, usecols=["entity", "code"]).drop_duplicates("entity")
    frame["kind"] = np.select(
        [frame.code.isin(OWID_HISTORICAL_STATES), frame.code.str.startswith(OWID_AGGREGATE_PREFIX)],
        ["historical_state", "aggregate"],
        "country",
    )
    return frame.rename(columns={"entity": "country", "code": "iso3"})


def decade_of(year: pd.Series | int):
    return (year // 10) * 10


def clean_owid(yearly_csv: Path, codes: pd.DataFrame, last_year: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """OWID's wide country-year table → (country records, world yearly).

    Records are long: one row per country × year × type with any reported
    impact. OWID writes 0 where EM-DAT reported nothing, so 0 is kept as "none
    reported" and every derived ratio requires both inputs to be positive.
    """
    wide = pd.read_csv(yearly_csv)
    wide = wide[wide.year <= last_year]
    wide = wide.merge(codes, on="country", how="left")
    unknown = wide[wide.kind.isna()].country.unique()
    if len(unknown):
        raise ValueError(f"OWID entities without a code: {sorted(unknown)[:10]}")

    frames = []
    world_frames = []
    for dtype in disaster_types.DISASTER_TYPES:
        columns = {f"{stem}_{dtype.owid_key}": metric for metric, stem in IMPACT_METRICS.items()}
        missing = [c for c in columns if c not in wide.columns]
        if missing:
            raise ValueError(f"OWID table is missing columns {missing}")
        part = wide[["country", "iso3", "kind", "year", *columns]].rename(columns=columns)
        part.insert(0, "type", dtype.id)

        world = part[part.country == "World"].drop(columns=["country", "iso3", "kind"])
        world_frames.append(world)

        part = part[part.kind != "aggregate"]
        impact = part[["deaths", "injured", "affected", "homeless", "total_affected", "damages_usd"]]
        frames.append(part[(impact.fillna(0) > 0).any(axis=1)])

    records = pd.concat(frames, ignore_index=True)
    money = ["damages_usd", "insured_usd", "reconstruction_usd",
             "damages_nominal_usd", "insured_nominal_usd", "reconstruction_nominal_usd"]
    people = ["deaths", "injured", "affected", "homeless", "total_affected"]
    records[people + money] = records[people + money].fillna(0)
    records[people] = records[people].round().astype("int64")
    records["decade"] = decade_of(records.year)
    records["historical_state"] = records.kind == "historical_state"
    records = records.drop(columns=["kind"])
    records = add_derived(records)
    records["severity_type"] = np.nan
    for dtype in disaster_types.IDS:
        mask = records.type == dtype
        records.loc[mask, "severity_type"] = severity_index(records[mask])
    records["severity_all"] = severity_index(records)
    records = records.sort_values(["type", "year", "country"]).reset_index(drop=True)

    world = pd.concat(world_frames, ignore_index=True).fillna(0)
    world[people] = world[people].round().astype("int64")
    return records, world


def add_derived(frame: pd.DataFrame) -> pd.DataFrame:
    """Fatality rate and average loss per affected person, where both inputs exist."""
    frame = frame.copy()
    both_people = (frame.deaths > 0) & (frame.total_affected > 0)
    frame["fatality_rate_pct"] = np.where(
        both_people, frame.deaths / frame.total_affected.where(frame.total_affected > 0) * 100, np.nan
    )
    both_money = (frame.damages_usd > 0) & (frame.total_affected > 0)
    frame["loss_per_affected_usd"] = np.where(
        both_money, frame.damages_usd / frame.total_affected.where(frame.total_affected > 0), np.nan
    )
    return frame


def severity_index(frame: pd.DataFrame) -> pd.Series:
    """0–100 Severity Index over the rows given (the population being ranked).

    Each component is ``log10(1 + x)`` min-max scaled to 0–1 within ``frame``;
    the log stops one extreme record from flattening every other to zero. A
    metric the source did not report contributes 0.
    """
    score = pd.Series(0.0, index=frame.index)
    for metric, weight in SEVERITY_WEIGHTS.items():
        values = np.log10(1 + frame[metric].clip(lower=0).astype(float))
        low, high = values.min(), values.max()
        scaled = (values - low) / (high - low) if high > low else values * 0
        score += weight * scaled
    return (score * 100).round(2)


def clean_events(events_csv: Path, last_year: int) -> pd.DataFrame:
    """World event counts per type and year (EM-DAT events via OWID)."""
    raw = pd.read_csv(events_csv)
    entity_to_type = {d.owid_events_entity: d.id for d in disaster_types.DISASTER_TYPES}
    raw = raw[raw.entity.isin(entity_to_type) & (raw.year <= last_year)]
    raw = raw.assign(type=raw.entity.map(entity_to_type))[["type", "year", "n_events"]]
    return raw.astype({"n_events": "int64"})


def build_world_yearly(world: pd.DataFrame, events: pd.DataFrame, first_year: int, last_year: int) -> pd.DataFrame:
    """Dense type × year grid of world totals and event counts (0 where none recorded)."""
    grid = pd.MultiIndex.from_product(
        [disaster_types.IDS, range(first_year, last_year + 1)], names=["type", "year"]
    ).to_frame(index=False)
    out = grid.merge(world, on=["type", "year"], how="left").merge(events, on=["type", "year"], how="left")
    numeric = [c for c in out.columns if c not in ("type", "year")]
    out[numeric] = out[numeric].fillna(0)
    out["n_events"] = out.n_events.astype("int64")
    out["decade"] = decade_of(out.year)
    return out.drop(columns=["damages_pct_gdp"], errors="ignore")


def clean_usgs(paths: list[Path], last_year: int) -> pd.DataFrame:
    """USGS ComCat pages → one row per M6+ earthquake."""
    frames = [pd.read_csv(path) for path in paths if path.stat().st_size > 0]
    raw = pd.concat(frames, ignore_index=True).drop_duplicates("id")
    raw = raw[raw.type == "earthquake"]
    time_ = pd.to_datetime(raw.time, utc=True, format="ISO8601")
    out = pd.DataFrame({
        "id": raw.id,
        "time": time_.dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "year": time_.dt.year,
        "month": time_.dt.month,
        "latitude": raw.latitude.round(3),
        "longitude": raw.longitude.round(3),
        "depth_km": raw.depth.round(1),
        "magnitude": raw.mag.round(2),
        "mag_type": raw.magType,
        "place": raw.place.fillna(""),
    })
    out = out[(out.year <= last_year) & (out.magnitude >= USGS_MIN_MAGNITUDE)]
    out["decade"] = decade_of(out.year)
    return out.sort_values("time").reset_index(drop=True)


def saffir_simpson(wind_kt: float) -> int:
    """Category from 1-minute sustained wind in knots; 0 = tropical storm."""
    for category, threshold in ((5, 137), (4, 113), (3, 96), (2, 83), (1, 64)):
        if wind_kt >= threshold:
            return category
    return 0


def clean_ibtracs(path: Path, last_year: int) -> pd.DataFrame:
    """IBTrACS 6-hourly track points → one row per tropical cyclone.

    Wind is the US agencies' 1-minute sustained wind (NHC/JTWC, all basins) so
    that categories are comparable; storms without it fall back to the WMO
    agency's wind, flagged in ``wind_source`` (those use 10-minute averaging and
    read lower, so they are never promoted to a category).
    """
    usecols = ["SID", "SEASON", "BASIN", "NAME", "ISO_TIME", "NATURE", "LAT", "LON",
               "WMO_WIND", "WMO_PRES", "USA_WIND", "USA_PRES", "DIST2LAND", "TRACK_TYPE"]
    raw = pd.read_csv(path, usecols=usecols, skiprows=[1], low_memory=False, keep_default_na=False,
                      na_values=[" ", ""])
    raw = raw[raw.TRACK_TYPE == "main"]
    for column in ["SEASON", "LAT", "LON", "WMO_WIND", "WMO_PRES", "USA_WIND", "USA_PRES", "DIST2LAND"]:
        raw[column] = pd.to_numeric(raw[column], errors="coerce")
    raw["ISO_TIME"] = pd.to_datetime(raw.ISO_TIME)
    raw["wind"] = raw.USA_WIND
    storms = []
    for sid, track in raw.groupby("SID", sort=False):
        use_usa = track.USA_WIND.notna().any()
        wind = track.USA_WIND if use_usa else track.WMO_WIND
        if wind.notna().sum() == 0:
            continue
        peak = track.loc[wind.idxmax()]
        max_wind = float(wind.max())
        if max_wind < TROPICAL_STORM_KT:
            continue
        pressure = track.USA_PRES if use_usa and track.USA_PRES.notna().any() else track.WMO_PRES
        first = track.ISO_TIME.min()
        storms.append({
            "sid": sid,
            "name": str(track.NAME.iloc[0]).title() if track.NAME.iloc[0] != "NOT_NAMED" else "Unnamed",
            "season": int(track.SEASON.iloc[0]),
            "basin": track.BASIN.mode().iloc[0] if track.BASIN.notna().any() else "",
            "genesis_date": first.strftime("%Y-%m-%d"),
            "month": int(first.month),
            "year": int(first.year),
            "lmi_latitude": round(float(peak.LAT), 2),
            "lmi_longitude": round(float(peak.LON), 2),
            "max_wind_kt": round(max_wind),
            "min_pressure_mb": float(pressure.min()) if pressure.notna().any() else np.nan,
            "wind_source": "usa_1min" if use_usa else "wmo",
            "category": saffir_simpson(max_wind) if use_usa else 0,
            "landfall": bool((track.DIST2LAND == 0).any()),
        })
    out = pd.DataFrame(storms)
    out = out[(out.season >= IBTRACS_FIRST_SEASON) & (out.season <= last_year)]
    # NA basin codes "NA" (North Atlantic) survive because keep_default_na=False.
    out["decade"] = decade_of(out.season)
    return out.sort_values("genesis_date").reset_index(drop=True)


def _ring_area_centroid(ring: list[list[float]]) -> tuple[float, float, float]:
    """Signed planar area and centroid of a lon/lat ring (shoelace)."""
    xs = np.array([p[0] for p in ring])
    ys = np.array([p[1] for p in ring])
    cross = xs[:-1] * ys[1:] - xs[1:] * ys[:-1]
    area = cross.sum() / 2
    if area == 0:
        return 0.0, float(xs.mean()), float(ys.mean())
    cx = ((xs[:-1] + xs[1:]) * cross).sum() / (6 * area)
    cy = ((ys[:-1] + ys[1:]) * cross).sum() / (6 * area)
    return abs(area), float(cx), float(cy)


def clean_countries(ne_50m: Path, codes: pd.DataFrame) -> pd.DataFrame:
    """Country centroids (largest polygon, Natural Earth 50 m) keyed by OWID name."""
    geo = json.loads(ne_50m.read_text(encoding="utf-8"))
    centroids = {}
    for feature in geo["features"]:
        code = feature["properties"]["ADM0_A3"]
        geometry = feature["geometry"]
        polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        best = max((_ring_area_centroid(polygon[0]) for polygon in polygons), key=lambda item: item[0])
        centroids[code] = (round(best[2], 3), round(best[1], 3))
    rows = []
    for row in codes[codes.kind != "aggregate"].itertuples():
        ne_code = NE_CODE_ALIASES.get(row.iso3, row.iso3)
        lat, lon = centroids.get(ne_code, (np.nan, np.nan))
        rows.append({"country": row.country, "iso3": row.iso3, "ne_code": ne_code,
                     "historical_state": row.kind == "historical_state",
                     "latitude": lat, "longitude": lon})
    return pd.DataFrame(rows)


def export_frontend_geo(ne_110m: Path, dest: Path = FRONTEND_GEO) -> Path:
    """Slim 110 m country shapes for the choropleth: iso3 + name, 2-decimal coordinates."""
    geo = json.loads(ne_110m.read_text(encoding="utf-8"))
    reverse = {v: k for k, v in NE_CODE_ALIASES.items()}

    def rnd(coords):
        if isinstance(coords[0], (int, float)):
            return [round(coords[0], 2), round(coords[1], 2)]
        return [rnd(c) for c in coords]

    features = [
        {
            "type": "Feature",
            "properties": {
                "iso3": reverse.get(f["properties"]["ADM0_A3"], f["properties"]["ADM0_A3"]),
                "name": f["properties"]["NAME"],
            },
            "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"])},
        }
        for f in geo["features"]
        if f["properties"]["ADM0_A3"] != "ATA"
    ]
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")),
                    encoding="utf-8")
    return dest


def clean_fx(path: Path) -> pd.DataFrame:
    """World Bank JSON → year, rupees per US$ (annual average). Years without a value are dropped."""
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = [(int(r["date"]), float(r["value"])) for r in payload[1] if r.get("value") is not None]
    frame = pd.DataFrame(rows, columns=["year", "inr_per_usd"]).sort_values("year")
    if frame.empty:
        raise ValueError("World Bank returned no INR/USD rates")
    return frame.reset_index(drop=True)


CLEAN_FILES = {
    "impact_records": "impact_records.csv",
    "world_yearly": "world_yearly.csv",
    "earthquakes": "earthquakes_usgs.csv",
    "cyclones": "cyclones_ibtracs.csv",
    "countries": "countries.csv",
    "fx_inr": "fx_inr_per_usd.csv",
}


def clean_all(paths: dict, today: datetime | None = None) -> dict[str, pd.DataFrame]:
    """Run every cleaning step and write ``CLEAN_DIR``; returns the tables."""
    codes = owid_codes(paths["owid_codes"])
    max_year = int(pd.read_csv(paths["owid_yearly"], usecols=["year"]).year.max())
    last_year = last_complete_year(max_year, today)
    records, world = clean_owid(paths["owid_yearly"], codes, last_year)
    events = clean_events(paths["owid_events"], last_year)
    first_year = int(min(records.year.min(), events.year.min()))
    tables = {
        "impact_records": records,
        "world_yearly": build_world_yearly(world, events, first_year, last_year),
        "earthquakes": clean_usgs(paths["usgs"], last_year),
        "cyclones": clean_ibtracs(paths["ibtracs"], last_year),
        "countries": clean_countries(paths["ne_50m"], codes),
        "fx_inr": clean_fx(paths["fx_inr"]),
    }
    CLEAN_DIR.mkdir(parents=True, exist_ok=True)
    for name, frame in tables.items():
        frame.to_csv(CLEAN_DIR / CLEAN_FILES[name], index=False, float_format="%.6g")
    meta = {
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "first_year": first_year,
        "last_complete_year": last_year,
        "partial_year_excluded": max_year if max_year > last_year else None,
        "usgs_min_magnitude": USGS_MIN_MAGNITUDE,
        "ibtracs_first_season": IBTRACS_FIRST_SEASON,
        "severity_weights": SEVERITY_WEIGHTS,
        "rows": {name: int(len(frame)) for name, frame in tables.items()},
        "sources": {
            "owid_yearly": OWID_YEARLY_URL,
            "owid_events": OWID_EVENTS_URL,
            "owid_codes": OWID_CODES_URL,
            "usgs": USGS_QUERY_URL,
            "ibtracs": IBTRACS_URL,
            "natural_earth": NE_50M_URL,
            "fx_inr": WB_INR_URL,
        },
    }
    (CLEAN_DIR / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    export_frontend_geo(paths["ne_110m"])
    return tables


# ── store ──────────────────────────────────────────────────────────────────
def build_store(clean_dir: Path = CLEAN_DIR, db_path: Path | None = None) -> Path:
    """Write every clean CSV into one SQLite file the API reads."""
    db_path = db_path or get_settings().db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = db_path.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    # closing(): sqlite3's own context manager commits but does not close, and
    # Windows cannot rename a file that is still open.
    with contextlib.closing(sqlite3.connect(tmp)) as conn, conn:
        for name, filename in CLEAN_FILES.items():
            pd.read_csv(clean_dir / filename, keep_default_na=False, na_values=[""]).to_sql(
                name, conn, index=False
            )
        conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
        meta = json.loads((clean_dir / "meta.json").read_text(encoding="utf-8"))
        conn.executemany("INSERT INTO meta VALUES (?, ?)", [(k, json.dumps(v)) for k, v in meta.items()])
        conn.execute("CREATE INDEX idx_records_type ON impact_records(type)")
    tmp.replace(db_path)
    return db_path


def ensure_store(db_path: Path | None = None) -> Path:
    """Build the SQLite store from ``clean/`` if it is missing or older than it."""
    db_path = db_path or get_settings().db_path
    newest_clean = max((CLEAN_DIR / f).stat().st_mtime for f in [*CLEAN_FILES.values(), "meta.json"])
    if not db_path.exists() or db_path.stat().st_mtime < newest_clean:
        logger.info("building %s from %s", db_path.name, CLEAN_DIR)
        build_store(CLEAN_DIR, db_path)
    return db_path


def load_store(db_path: Path | None = None) -> dict[str, pd.DataFrame | dict]:
    """Every table as a DataFrame, plus ``meta`` as a dict."""
    db_path = ensure_store(db_path)
    with contextlib.closing(sqlite3.connect(db_path)) as conn:
        tables = {name: pd.read_sql(f"SELECT * FROM {name}", conn) for name in CLEAN_FILES}
        meta = {k: json.loads(v) for k, v in conn.execute("SELECT key, value FROM meta")}
    for flag in ("historical_state",):
        for name in ("impact_records", "countries"):
            tables[name][flag] = tables[name][flag].astype(str).str.lower().isin(["1", "true"])
    tables["cyclones"]["landfall"] = tables["cyclones"]["landfall"].astype(str).str.lower().isin(["1", "true"])
    tables["meta"] = meta
    return tables


# ── verification ───────────────────────────────────────────────────────────
KNOWN_EVENTS = [
    # (type, country, year, what the public record says)
    ("earthquake", "Haiti", 2010, "EM-DAT: 222,570 deaths"),
    ("cyclone", "Myanmar", 2008, "Cyclone Nargis, EM-DAT: 138,366 deaths"),
    ("flood", "Pakistan", 2010, "EM-DAT: ~1,985 deaths, ~20 M affected"),
    ("earthquake", "Turkey", 2023, "Kahramanmaras earthquakes: ~50,000 deaths in Turkey"),
    ("cyclone", "United States", 2005, "Katrina year: ~US$125 bn nominal damages (Katrina alone)"),
]


def verify(tables: dict | None = None) -> None:
    """Print the records behind well-known events next to what the public record says."""
    tables = tables or load_store()
    records = tables["impact_records"]
    for dtype, country, year, note in KNOWN_EVENTS:
        row = records[(records.type == dtype) & (records.country == country) & (records.year == year)]
        if row.empty:
            print(f"MISSING {dtype} {country} {year}")
            continue
        r = row.iloc[0]
        print(f"{dtype:10} {country:14} {year}: deaths={r.deaths:,} total_affected={r.total_affected:,} "
              f"damages=US${r.damages_usd / 1e9:,.2f}bn (2024$)  | {note}")
    quakes = tables["earthquakes"]
    haiti = quakes[(quakes.year == 2010) & quakes.place.str.contains("Haiti")]
    print("USGS Haiti 2010:", haiti[["time", "magnitude", "place"]].to_dict("records")[:2])
    storms = tables["cyclones"]
    print("IBTrACS Katrina:", storms[(storms.name == "Katrina") & (storms.season == 2005)].to_dict("records"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--refresh", action="store_true", help="re-download every source")
    parser.add_argument("--verify", action="store_true", help="only print sanity checks")
    args = parser.parse_args(argv)
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    if not args.verify:
        use_system_trust_store()
        paths = fetch_all(refresh=args.refresh)
        tables = clean_all(paths)
        for name, frame in tables.items():
            logger.info("clean    %-15s %6d rows", name, len(frame))
        build_store()
    verify()
    return 0


if __name__ == "__main__":
    sys.exit(main())
