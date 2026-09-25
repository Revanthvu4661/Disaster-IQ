"""Flood-risk data for the 14 districts of Kerala: fetch -> clean -> features.

    python -m backend.flood_pipeline            # use cached raw files, download missing
    python -m backend.flood_pipeline --refresh  # re-download everything
    python -m backend.flood_pipeline --current  # re-fetch the latest NASA POWER data only

Sources, all free and without an API key (details in docs/DATA_SOURCES.md):

1. Kerala flood dataset: IMD monthly rainfall for the Kerala subdivision,
   1901-2018, with a FLOODS yes/no flag. One row per year for the whole state.
2. India Flood Inventory (IFI) v3.0: flood events 1967-2023 compiled from IMD
   reports, with the districts each event touched and recorded deaths.
3. NASA POWER daily point API: precipitation (PRECTOTCORR, mm/day) and
   root-zone soil wetness (GWETROOT, 0-1) at each district centroid, 1981 on.
4. Elevation: Open-Elevation, falling back to Open-Meteo's elevation API
   (Copernicus GLO-90 DEM) when Open-Elevation does not answer.
5. geoBoundaries IND ADM2 (district polygons, ODbL).
6. Census of India 2011 district table (population, households).

River gauge levels are not included: no free, documented, no-key source was
integrated in this build.

Outputs (committed, so the API and tests run offline):

    backend/data/clean/flood/districts.csv   one row per district: centroid,
                                             area, elevation, census, IFI history
    backend/data/clean/flood/months.csv      district x monsoon month (June-September)
                                             1981-2023: features and the observed label
    backend/data/clean/flood/current.csv     district x the latest 30 days
    backend/data/clean/flood/ifi_kerala_events.csv  IFI events, one row per district
    backend/data/clean/flood/kerala_imd.csv  the Kerala dataset (state level)
    backend/data/clean/flood/meta.json       build time, sources, date ranges
    frontend/public/geo/kerala-districts.json simplified district polygons
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

from backend.config import DATA_DIR
from backend.data_pipeline import HTTP_HEADERS, download, use_system_trust_store

logger = logging.getLogger("flood_pipeline")

RAW_DIR = DATA_DIR / "raw" / "flood"
CLEAN_DIR = DATA_DIR / "clean" / "flood"
FRONTEND_GEO = DATA_DIR.parent.parent / "frontend" / "public" / "geo" / "kerala-districts.json"

KERALA_CSV_URL = "https://raw.githubusercontent.com/amandp13/Flood-Prediction-Model/master/kerala.csv"
IFI_URL = (
    "https://raw.githubusercontent.com/hydrosenselab/India-Flood-Inventory/main/v3.0/"
    "India_Flood_Inventory_v3.csv"
)
GEOBOUNDARIES_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM2/"
    "geoBoundaries-IND-ADM2_simplified.geojson"
)
CENSUS_URL = (
    "https://raw.githubusercontent.com/nishusharma1608/India-Census-2011-Analysis/master/"
    "india-districts-census-2011.csv"
)
POWER_DAILY_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
OPEN_ELEVATION_URL = "https://api.open-elevation.com/api/v1/lookup"
OPEN_METEO_ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"

#: The 14 districts, north to south. Names as geoBoundaries, the census and IFI spell them.
DISTRICTS = [
    "Kasaragod", "Kannur", "Wayanad", "Kozhikode", "Malappuram", "Palakkad", "Thrissur",
    "Ernakulam", "Idukki", "Kottayam", "Alappuzha", "Pathanamthitta", "Kollam",
    "Thiruvananthapuram",
]
KERALA_STATE_POPULATION_2011 = 33_406_061

POWER_START = date(1981, 1, 1)  # first year of NASA POWER's MERRA-2 daily record
IFI_LAST_YEAR = 2023            # last year covered by IFI v3.0
SEASON_MONTHS = (6, 7, 8, 9)    # southwest monsoon, June-September
NORMAL_YEARS = (1991, 2020)     # WMO standard normal period
PRIOR_WINDOW = 10               # seasons of flood history behind `prior_flood_rate`
ANTECEDENT_DAYS = 7             # soil wetness is averaged over the week before a window
CURRENT_WINDOW_DAYS = 30        # "current conditions" = the latest 30 days of POWER data
ELEVATION_GRID_DEG = 0.07       # ~7.7 km sample spacing inside each district
LOW_LYING_M = 10                # "low-lying" means below this elevation


# ── fetch ──────────────────────────────────────────────────────────────────


def _power_path(district: str) -> Path:
    return RAW_DIR / "power" / f"{district.lower()}.json"


def fetch_power(district: str, lat: float, lon: float, *, end: date, refresh: bool = False) -> Path:
    """Daily precipitation and soil wetness at one point, 1981 to ``end``."""
    params = {
        "parameters": "PRECTOTCORR,GWETROOT",
        "community": "AG",
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "start": POWER_START.strftime("%Y%m%d"),
        "end": end.strftime("%Y%m%d"),
        "format": "JSON",
    }
    return download(POWER_DAILY_URL, _power_path(district), refresh=refresh, params=params, timeout=300)


def _chunks(items: list, size: int):
    for start in range(0, len(items), size):
        yield items[start:start + size]


def fetch_elevations(points: list[tuple[float, float]]) -> tuple[list[float], str]:
    """Elevation in metres for (lat, lon) points; returns the values and the source used."""
    try:
        values: list[float] = []
        with httpx.Client(timeout=60, headers=HTTP_HEADERS) as client:
            for batch in _chunks(points, 200):
                body = {"locations": [{"latitude": lat, "longitude": lon} for lat, lon in batch]}
                response = client.post(OPEN_ELEVATION_URL, json=body)
                response.raise_for_status()
                values.extend(float(r["elevation"]) for r in response.json()["results"])
        return values, "open-elevation"
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        logger.warning("Open-Elevation failed (%s); using Open-Meteo elevation", str(exc)[:120])

    values = []
    with httpx.Client(timeout=60, headers=HTTP_HEADERS) as client:
        for batch in _chunks(points, 100):  # Open-Meteo takes up to 100 coordinates per call
            params = {
                "latitude": ",".join(f"{lat:.4f}" for lat, _ in batch),
                "longitude": ",".join(f"{lon:.4f}" for _, lon in batch),
            }
            for _attempt in range(6):
                response = client.get(OPEN_METEO_ELEVATION_URL, params=params)
                if response.status_code != 429:
                    break
                time.sleep(65)  # the free tier limits coordinates per minute
            response.raise_for_status()
            values.extend(float(v) for v in response.json()["elevation"])
            time.sleep(8)
    return values, "open-meteo"


def fetch_static(refresh: bool = False) -> dict[str, Path]:
    return {
        "kerala": download(KERALA_CSV_URL, RAW_DIR / "kerala.csv", refresh=refresh),
        "ifi": download(IFI_URL, RAW_DIR / "ifi_v3.csv", refresh=refresh),
        "geo": download(GEOBOUNDARIES_URL, RAW_DIR / "ind_adm2_simplified.geojson", refresh=refresh),
        "census": download(CENSUS_URL, RAW_DIR / "census_2011_districts.csv", refresh=refresh),
    }


# ── clean: districts ───────────────────────────────────────────────────────


def district_shapes(geo_path: Path) -> dict:
    """The 14 Kerala district geometries (shapely) from the India ADM2 file."""
    from shapely.geometry import shape

    features = json.loads(geo_path.read_text(encoding="utf-8"))["features"]
    by_name = {f["properties"]["shapeName"]: f for f in features}
    missing = [d for d in DISTRICTS if d not in by_name]
    if missing:
        raise ValueError(f"geoBoundaries has no polygon for: {', '.join(missing)}")
    return {d: shape(by_name[d]["geometry"]) for d in DISTRICTS}


def export_frontend_geo(shapes: dict, dest: Path = FRONTEND_GEO) -> Path:
    """Simplified polygons for the risk map (about 0.3 km tolerance, 4 decimals)."""
    from shapely.geometry import mapping

    def rounded(coords):
        if isinstance(coords[0], (int, float)):
            return [round(coords[0], 4), round(coords[1], 4)]
        return [rounded(c) for c in coords]

    features = []
    for name, geom in shapes.items():
        simple = mapping(geom.simplify(0.003, preserve_topology=True))
        features.append({
            "type": "Feature",
            "properties": {"district": name},
            "geometry": {"type": simple["type"], "coordinates": rounded(simple["coordinates"])},
        })
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")),
                    encoding="utf-8")
    return dest


def elevation_samples(shapes: dict) -> dict[str, list[tuple[float, float]]]:
    """A regular grid of points inside each district (at least the centroid)."""
    from shapely.geometry import Point
    from shapely.prepared import prep

    samples = {}
    for name, geom in shapes.items():
        minx, miny, maxx, maxy = geom.bounds
        inside = prep(geom)
        pts = [
            (round(lat, 4), round(lon, 4))
            for lat in np.arange(miny + ELEVATION_GRID_DEG / 2, maxy, ELEVATION_GRID_DEG)
            for lon in np.arange(minx + ELEVATION_GRID_DEG / 2, maxx, ELEVATION_GRID_DEG)
            if inside.contains(Point(lon, lat))
        ]
        c = geom.representative_point()
        samples[name] = pts or [(round(c.y, 4), round(c.x, 4))]
    return samples


def clean_census(path: Path) -> pd.DataFrame:
    census = pd.read_csv(path)
    kerala = census[census["State name"].str.upper() == "KERALA"]
    out = kerala.rename(columns={"District name": "district", "Population": "population",
                                 "Households": "households"})[["district", "population", "households"]]
    if sorted(out["district"]) != sorted(DISTRICTS):
        raise ValueError("census districts do not match the 14 Kerala districts")
    if int(out["population"].sum()) != KERALA_STATE_POPULATION_2011:
        raise ValueError("census district populations do not sum to Kerala's 2011 total")
    return out


# ── clean: IFI flood events ────────────────────────────────────────────────


def _date_readings(text: str) -> list[date]:
    """Both readings of an IFI date: day-first ("08-01-2018" = 8 Jan) and month-first (1 Aug)."""
    match = re.match(r"\s*(\d{1,2})-(\d{1,2})-(\d{4})", str(text))
    if not match:
        return []
    a, b, year = (int(g) for g in match.groups())
    readings = []
    for day, month in ((a, b), (b, a)):
        try:
            readings.append(date(year, month, day))
        except ValueError:
            continue
    return sorted(set(readings))


def resolve_ifi_dates(events: pd.DataFrame) -> pd.DataFrame:
    """Fix IFI's mixed day-first / month-first dates.

    IFI mostly writes dd-mm-yyyy, but some ambiguous dates are month-first: the
    main August 2018 Kerala event is stored as 08-01-2018 to 30-08-2018 with a
    30-day duration, i.e. 1-30 August. Event ids (UEI) are numbered in date
    order within a year, so each start date takes the reading that keeps that
    order (the earliest reading on or after the previous event's start), and
    each end date the reading that best matches the recorded duration.
    """
    events = events.copy()
    events["_seq"] = events["UEI"].str.extract(r"-(\d{4})-(\d{4})$").astype(int).apply(tuple, axis=1)
    events = events.sort_values("_seq")
    starts, ends = [], []
    last: date | None = None
    last_year = None
    columns = zip(events["_seq"], events["Start Date"], events["End Date"], events["Duration(Days)"])
    for seq, start_text, end_text, duration in columns:
        readings = _date_readings(start_text)
        year = seq[0]
        if year != last_year:
            last, last_year = date(year, 1, 1), year
        if not readings:
            starts.append(None)
            ends.append(None)
            continue
        after = [d for d in readings if d >= last]
        start = after[0] if after else readings[0]
        last = max(last, start)
        duration = None if pd.isna(duration) else float(duration)
        end_readings = [d for d in _date_readings(end_text) if d >= start] or [start]
        if duration:
            end = min(end_readings, key=lambda d: abs((d - start).days + 1 - duration))
        else:
            end = end_readings[0]
        starts.append(start)
        ends.append(end)
    events["start"] = pd.to_datetime(pd.Series(starts, index=events.index))
    events["end"] = pd.to_datetime(pd.Series(ends, index=events.index))
    return events.drop(columns="_seq")


def clean_ifi(path: Path) -> pd.DataFrame:
    """Kerala events from the India Flood Inventory, one row per event x district."""
    ifi = pd.read_csv(path, encoding="latin-1")
    kerala = ifi[ifi["State"].fillna("").str.contains("Kerala", case=False)]
    kerala = resolve_ifi_dates(kerala[["UEI", "Start Date", "End Date", "Duration(Days)", "Districts",
                                       "Human fatality"]])
    kerala["deaths"] = pd.to_numeric(kerala["Human fatality"], errors="coerce")
    kerala["duration_days"] = pd.to_numeric(kerala["Duration(Days)"], errors="coerce")
    rows = []
    for _, event in kerala.dropna(subset=["start"]).iterrows():
        listed = str(event["Districts"]).lower()
        for district in DISTRICTS:
            if re.search(rf"\b{district.lower()}\b", listed):
                rows.append({
                    "uei": event["UEI"],
                    "district": district,
                    "start": event["start"].date().isoformat(),
                    "end": event["end"].date().isoformat(),
                    "year": int(event["start"].year),
                    "month": int(event["start"].month),
                    "duration_days": event["duration_days"],
                    "deaths": event["deaths"],
                })
    return pd.DataFrame(rows)


def month_windows(year: int) -> list[tuple[int, pd.Timestamp, pd.Timestamp]]:
    """The four monsoon months of one year as (month, first day, last day)."""
    return [(m, pd.Timestamp(year, m, 1), pd.Timestamp(year, m, 1) + pd.offsets.MonthEnd(0))
            for m in SEASON_MONTHS]


def month_labels(events: pd.DataFrame, first_year: int, last_year: int) -> pd.DataFrame:
    """District x monsoon month: did IFI record a flood event touching the district?

    ``flood``    an IFI event that lists the district overlaps the month. This is
                 the training label.
    ``deadly``   one of those events recorded at least one death (context only).

    A multi-district event is one record with one death toll, so it counts for
    every district it lists.
    """
    start = pd.to_datetime(events["start"])
    end = pd.to_datetime(events["end"])
    rows = []
    for year in range(first_year, last_year + 1):
        in_year = events[(start.dt.year <= year) & (end.dt.year >= year)]
        s, e = start[in_year.index], end[in_year.index]
        for month, first, last in month_windows(year):
            hits = in_year[(s <= last) & (e >= first)]
            for district in DISTRICTS:
                mine = hits[hits["district"] == district]
                rows.append({
                    "district": district,
                    "year": year,
                    "month": month,
                    "events": int(mine["uei"].nunique()),
                    "flood": int(len(mine) > 0),
                    "deadly": int((mine["deaths"] >= 1).any()),
                    "event_deaths": float(mine.drop_duplicates("uei")["deaths"].sum(min_count=1)),
                })
    return pd.DataFrame(rows)


def prior_rate(labels: pd.DataFrame, district: str, year: int, window: int = PRIOR_WINDOW) -> float:
    """Share of the district's previous ``window`` IFI monsoon seasons with a recorded flood.

    Uses only seasons before ``year`` that IFI covers, so a training row never
    sees its own label.
    """
    last = min(year - 1, IFI_LAST_YEAR)
    rows = labels[(labels["district"] == district) & labels["year"].between(last - window + 1, last)]
    seasons = rows.groupby("year")["flood"].max()
    return float(seasons.mean()) if len(seasons) else float("nan")


# ── clean: NASA POWER features ─────────────────────────────────────────────


def load_power(path: Path) -> pd.DataFrame:
    """Daily series from a POWER JSON response; POWER's fill value -999 becomes NaN."""
    params = json.loads(path.read_text(encoding="utf-8"))["properties"]["parameter"]
    frame = pd.DataFrame({
        "rain_mm": pd.Series(params["PRECTOTCORR"]),
        "soil_wetness": pd.Series(params["GWETROOT"]),
    })
    frame.index = pd.to_datetime(frame.index, format="%Y%m%d")
    return frame.replace(-999.0, np.nan).sort_index()


def normal_rain(daily: pd.DataFrame, first: pd.Timestamp, last: pd.Timestamp) -> float:
    """Mean rainfall between the same calendar dates over the normal period (1991-2020)."""
    totals = []
    for year in range(NORMAL_YEARS[0], NORMAL_YEARS[1] + 1):
        a = pd.Timestamp(year, first.month, first.day)
        b = pd.Timestamp(year + (last.year - first.year), last.month, last.day)
        totals.append(daily.loc[a:b, "rain_mm"].sum())
    return float(np.mean(totals))


def window_features(daily: pd.DataFrame, first: pd.Timestamp, last: pd.Timestamp) -> dict:
    """Rainfall and soil features for one window of days (inclusive)."""
    rain = daily.loc[first:last, "rain_mm"]
    before = daily.loc[first - pd.Timedelta(days=ANTECEDENT_DAYS):first - pd.Timedelta(days=1), "soil_wetness"]
    normal = normal_rain(daily, first, last)
    total = float(rain.sum())
    return {
        "days": int(rain.notna().sum()),
        "rain_mm": round(total, 1),
        "normal_mm": round(normal, 1),
        "rain_pct_normal": round(total / normal * 100, 1) if normal > 0 else float("nan"),
        "max_3day_rain_mm": round(float(rain.rolling(3, min_periods=3).sum().max()), 1),
        "soil_wetness_before": round(float(before.mean()), 3),
    }


# ── build ──────────────────────────────────────────────────────────────────


def build(refresh: bool = False, current_only: bool = False, today: date | None = None) -> dict:
    today = today or datetime.now(timezone.utc).date()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    CLEAN_DIR.mkdir(parents=True, exist_ok=True)
    paths = fetch_static(refresh=refresh and not current_only)
    shapes = district_shapes(paths["geo"])

    # Districts: centroid, area, census, elevation.
    census = clean_census(paths["census"]).set_index("district")
    samples = elevation_samples(shapes)
    flat = [p for name in DISTRICTS for p in samples[name]]
    cache = RAW_DIR / "elevation_samples.json"
    cached = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else {}
    if cached.get("points") == [list(p) for p in flat] and not refresh:
        values, elevation_source = cached["values"], cached["source"]
    else:
        logger.info("elevation: %d sample points", len(flat))
        values, elevation_source = fetch_elevations(flat)
        cache.write_text(json.dumps({"points": flat, "values": values, "source": elevation_source}),
                         encoding="utf-8")
    rows, cursor = [], 0
    for name in DISTRICTS:
        geom = shapes[name]
        n = len(samples[name])
        elev = np.array(values[cursor:cursor + n])
        cursor += n
        centroid = geom.representative_point()
        area_km2 = geom.area * (111.32 ** 2) * np.cos(np.radians(centroid.y))
        rows.append({
            "district": name,
            "lat": round(centroid.y, 4),
            "lon": round(centroid.x, 4),
            "area_km2": round(float(area_km2)),
            "elevation_m": round(float(elev.mean()), 1),
            "elevation_median_m": round(float(np.median(elev)), 1),
            "low_lying_pct": round(float((elev < LOW_LYING_M).mean() * 100), 1),
            "elevation_samples": n,
            "population": int(census.loc[name, "population"]),
            "households": int(census.loc[name, "households"]),
        })
    districts = pd.DataFrame(rows)
    export_frontend_geo(shapes)

    # NASA POWER daily series per district, 1981 to yesterday.
    end = today - timedelta(days=1)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(
            lambda r: fetch_power(r.district, r.lat, r.lon, end=end, refresh=refresh or current_only),
            districts.itertuples(),
        ))
    daily = {name: load_power(_power_path(name)) for name in DISTRICTS}

    # Labels and history from IFI.
    events = clean_ifi(paths["ifi"])
    labels = month_labels(events, first_year=1967, last_year=IFI_LAST_YEAR)
    seasons = labels.groupby(["district", "year"]).agg(flood=("flood", "max"), deadly=("deadly", "max"))
    history = seasons.groupby("district").agg(
        ifi_seasons=("flood", "size"),
        ifi_flood_seasons=("flood", "sum"),
        ifi_deadly_seasons=("deadly", "sum"),
    ).reset_index()
    history["ifi_first_year"] = int(labels["year"].min())
    districts = districts.merge(history, on="district")

    # Training table: every monsoon month that POWER and IFI both cover.
    info = districts.set_index("district")
    month_rows = []
    for name in DISTRICTS:
        for year in range(POWER_START.year, IFI_LAST_YEAR + 1):
            prior = round(prior_rate(labels, name, year), 3)
            for month, first, last in month_windows(year):
                label = labels[(labels["district"] == name) & (labels["year"] == year)
                               & (labels["month"] == month)].iloc[0]
                month_rows.append({
                    "district": name,
                    "year": year,
                    "month": month,
                    **window_features(daily[name], first, last),
                    "elevation_m": info.loc[name, "elevation_m"],
                    "prior_flood_rate": prior,
                    "events": int(label["events"]),
                    "event_deaths": label["event_deaths"],
                    "deadly": int(label["deadly"]),
                    "flood": int(label["flood"]),
                })
    months = pd.DataFrame(month_rows)

    # Current conditions: the latest CURRENT_WINDOW_DAYS days of POWER data.
    current_rows = []
    for name in DISTRICTS:
        last = daily[name]["rain_mm"].last_valid_index()
        first = last - pd.Timedelta(days=CURRENT_WINDOW_DAYS - 1)
        current_rows.append({
            "district": name,
            "window_start": first.date().isoformat(),
            "as_of": last.date().isoformat(),
            **window_features(daily[name], first, last),
            "elevation_m": info.loc[name, "elevation_m"],
            "prior_flood_rate": round(prior_rate(labels, name, last.year), 3),
        })
    current = pd.DataFrame(current_rows)

    # The Kerala dataset as published (state level), plus POWER's state mean for the cross-check.
    kerala = pd.read_csv(paths["kerala"])
    kerala.columns = [c.strip().lower().replace(" ", "_") for c in kerala.columns]
    kerala = kerala.drop(columns=["subdivision"])
    kerala["floods"] = (kerala["floods"].str.strip().str.upper() == "YES").astype(int)
    power_annual = pd.concat(
        [d["rain_mm"].groupby(d.index.year).sum() for d in daily.values()], axis=1
    ).mean(axis=1).rename("power_annual_rainfall_mm")
    kerala = kerala.merge(power_annual.round(1), left_on="year", right_index=True, how="left")

    districts.to_csv(CLEAN_DIR / "districts.csv", index=False)
    months.to_csv(CLEAN_DIR / "months.csv", index=False)
    current.to_csv(CLEAN_DIR / "current.csv", index=False)
    kerala.to_csv(CLEAN_DIR / "kerala_imd.csv", index=False)
    events.to_csv(CLEAN_DIR / "ifi_kerala_events.csv", index=False)
    stale = CLEAN_DIR / "seasons.csv"
    if stale.exists():
        stale.unlink()
    meta = {
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "elevation_source": elevation_source,
        "power_first_day": POWER_START.isoformat(),
        "power_last_day": max(d["rain_mm"].last_valid_index() for d in daily.values()).date().isoformat(),
        "training_years": [POWER_START.year, IFI_LAST_YEAR],
        "normal_period": list(NORMAL_YEARS),
        "current_window_days": CURRENT_WINDOW_DAYS,
        "ifi_last_year": IFI_LAST_YEAR,
    }
    (CLEAN_DIR / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    logger.info("districts %d, district-months %d (flood rate %.3f), current window %s to %s, "
                "elevation from %s", len(districts), len(months), months["flood"].mean(),
                current["window_start"].min(), current["as_of"].max(), elevation_source)
    return {"districts": districts, "months": months, "current": current, "kerala": kerala,
            "events": events, "meta": meta}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--refresh", action="store_true", help="re-download every source")
    parser.add_argument("--current", action="store_true", help="re-fetch the latest NASA POWER data only")
    args = parser.parse_args(argv)
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    use_system_trust_store()
    build(refresh=args.refresh, current_only=args.current)
    return 0


if __name__ == "__main__":
    sys.exit(main())
