"""Flood-risk data for every district of India: fetch -> clean -> features.

    python -m backend.flood_pipeline                    # all India, cached raw files reused
    python -m backend.flood_pipeline --refresh          # re-download everything
    python -m backend.flood_pipeline --current          # re-fetch the latest NASA POWER data only
    python -m backend.flood_pipeline --states Kerala,Assam   # one part; writes to clean/flood/partial/

Sources, all free and without an API key (details in docs/DATA_SOURCES.md):

1. India Flood Inventory (IFI) v3.0: flood events 1967-2023 compiled from IMD
   reports, with the districts each event touched and recorded deaths.
2. NASA POWER daily point API: precipitation (PRECTOTCORR, mm/day) and
   root-zone soil wetness (GWETROOT, 0-1), 1981 on. One request per unique
   MERRA-2 grid cell (0.5 deg latitude x 0.625 deg longitude) that holds a
   district centroid; every district in the cell shares that series.
3. Elevation: Open-Elevation, falling back to Open-Meteo's elevation API
   (Copernicus GLO-90 DEM) when Open-Elevation does not answer.
4. geoBoundaries IND ADM2 (district polygons, ODbL) and ADM1 (state polygons,
   used to give each district its state).
5. Census of India 2011 district table (population, households).
6. Kerala flood dataset: IMD monthly rainfall for the Kerala subdivision,
   1901-2018, with a FLOODS yes/no flag. Kerala only; used as a check.

District names are matched across IFI, the census and geoBoundaries inside each
state (``backend/district_names.py``); fixes by hand live in
``district_aliases.csv`` and every name that still fails is written to
``unmatched_names.csv``. A district created after 2011 has no census row: its
population is left empty, never estimated.

River gauge levels are not included: no free, documented, no-key source was
integrated in this build.

Outputs (committed, so the API and tests run offline):

    backend/data/clean/flood/districts.csv        one row per district: state, centroid, POWER cell,
                                                  area, elevation, census, IFI history
    backend/data/clean/flood/months.csv.gz        district x calendar month 1981-2023: features and
                                                  the observed label
    backend/data/clean/flood/current.csv          district x the latest 30 days
    backend/data/clean/flood/ifi_events.csv       IFI events, one row per event x district
    backend/data/clean/flood/kerala_imd.csv       the Kerala dataset (state level)
    backend/data/clean/flood/unmatched_names.csv  names that could not be matched, and districts without a census row
    backend/data/clean/flood/meta.json            build time, sources, date ranges
    frontend/public/geo/india-districts.json      simplified district polygons
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
from backend.district_names import (
    DistrictIndex,
    canon_state,
    load_aliases,
    split_districts,
    split_states,
    strip_accents,
)

logger = logging.getLogger("flood_pipeline")

RAW_DIR = DATA_DIR / "raw" / "flood"
CLEAN_DIR = DATA_DIR / "clean" / "flood"
PARTIAL_DIR = CLEAN_DIR / "partial"
ALIASES_PATH = CLEAN_DIR / "district_aliases.csv"
FRONTEND_GEO = DATA_DIR.parent.parent / "frontend" / "public" / "geo" / "india-districts.json"

KERALA_CSV_URL = "https://raw.githubusercontent.com/amandp13/Flood-Prediction-Model/master/kerala.csv"
IFI_URL = (
    "https://raw.githubusercontent.com/hydrosenselab/India-Flood-Inventory/main/v3.0/"
    "India_Flood_Inventory_v3.csv"
)
GEOBOUNDARIES_ADM2_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM2/"
    "geoBoundaries-IND-ADM2_simplified.geojson"
)
GEOBOUNDARIES_ADM1_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM1/"
    "geoBoundaries-IND-ADM1_simplified.geojson"
)
CENSUS_URL = (
    "https://raw.githubusercontent.com/nishusharma1608/India-Census-2011-Analysis/master/"
    "india-districts-census-2011.csv"
)
POWER_DAILY_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
OPEN_ELEVATION_URL = "https://api.open-elevation.com/api/v1/lookup"
OPEN_METEO_ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"

#: Yanam is a Puducherry enclave inside Andhra Pradesh; the simplified state polygon covers it.
STATE_OVERRIDES = {"Yanam": "Puducherry"}

KERALA_STATE = "Kerala"
KERALA_STATE_POPULATION_2011 = 33_406_061

POWER_START = date(1981, 1, 1)  # first year of NASA POWER's MERRA-2 daily record
POWER_LAT_STEP = 0.5            # MERRA-2 native grid: 0.5 deg latitude ...
POWER_LON_STEP = 0.625          # ... by 0.625 deg longitude
POWER_WORKERS = 3
POWER_PAUSE_S = 1.0             # delay between request starts, per worker
POWER_ATTEMPTS = 5
IFI_FIRST_YEAR = 1967
IFI_LAST_YEAR = 2023            # last year covered by IFI v3.0
MONTHS = tuple(range(1, 13))    # every calendar month: northeast-monsoon floods (Oct-Dec) count too
NORMAL_YEARS = (1991, 2020)     # WMO standard normal period
PRIOR_WINDOW = 10               # years of flood history behind `prior_flood_rate`
ANTECEDENT_DAYS = 7             # soil wetness is averaged over the week before a window
CURRENT_WINDOW_DAYS = 30        # "current conditions" = the latest 30 days of POWER data
MAX_RAIN_PCT = 1000.0           # cap on rain as % of normal, so near-dry months do not give 50,000%
ELEVATION_GRID_DEG = 0.07       # densest sample spacing inside a district (~7.7 km)
ELEVATION_MAX_SAMPLES = 25      # points per district; big districts get a coarser grid
LOW_LYING_M = 10                # "low-lying" means below this elevation
GEO_SIMPLIFY_DEG = 0.01         # ~1 km tolerance for the frontend polygons
GEO_MAX_BYTES = 2_000_000


# ── fetch ──────────────────────────────────────────────────────────────────


def power_cell(lat: float, lon: float) -> tuple[float, float]:
    """Centre of the MERRA-2 grid cell holding a point."""
    return (round(round(lat / POWER_LAT_STEP) * POWER_LAT_STEP, 3),
            round(-180 + round((lon + 180) / POWER_LON_STEP) * POWER_LON_STEP, 3))


def _power_path(cell: tuple[float, float]) -> Path:
    return RAW_DIR / "power" / f"cell_{cell[0]:.3f}_{cell[1]:.3f}.json"


def fetch_power(cell: tuple[float, float], *, end: date, refresh: bool = False) -> Path:
    """Daily precipitation and soil wetness at one grid cell, 1981 to ``end`` (cached, retried)."""
    params = {
        "parameters": "PRECTOTCORR,GWETROOT",
        "community": "AG",
        "latitude": f"{cell[0]:.3f}",
        "longitude": f"{cell[1]:.3f}",
        "start": POWER_START.strftime("%Y%m%d"),
        "end": end.strftime("%Y%m%d"),
        "format": "JSON",
    }
    path = _power_path(cell)
    for attempt in range(1, POWER_ATTEMPTS + 1):
        try:
            time.sleep(POWER_PAUSE_S)
            return download(POWER_DAILY_URL, path, refresh=refresh, params=params, timeout=300)
        except (httpx.HTTPError, ValueError) as exc:
            if attempt == POWER_ATTEMPTS:
                raise
            wait = 10 * attempt
            logger.warning("POWER cell %s failed (%s); retry %d in %ds", cell, str(exc)[:80], attempt, wait)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def _chunks(items: list, size: int):
    for start in range(0, len(items), size):
        yield items[start:start + size]


def _elevation_key(point: tuple[float, float]) -> str:
    return f"{point[0]:.4f},{point[1]:.4f}"


def fetch_elevations(points: list[tuple[float, float]], cache: dict[str, float],
                     save) -> str:
    """Fill ``cache`` (point key -> metres) for every point; returns the source used.

    Open-Elevation is tried first; when it does not answer, Open-Meteo's
    elevation API (Copernicus GLO-90) is used, 100 points a call. ``save`` is
    called after each batch so an interrupted run resumes where it stopped.
    """
    todo = [p for p in points if _elevation_key(p) not in cache]
    if not todo:
        return cache.get("_source", "open-meteo")
    source = "open-meteo"
    try:
        with httpx.Client(timeout=30, headers=HTTP_HEADERS) as client:
            probe = client.post(OPEN_ELEVATION_URL, json={"locations": [
                {"latitude": lat, "longitude": lon} for lat, lon in todo[:2]]})
            probe.raise_for_status()
            probe.json()["results"][0]["elevation"]
        source = "open-elevation"
    except (httpx.HTTPError, KeyError, ValueError, IndexError) as exc:
        logger.warning("Open-Elevation not usable (%s); using Open-Meteo elevation", str(exc)[:100])

    with httpx.Client(timeout=60, headers=HTTP_HEADERS) as client:
        for number, batch in enumerate(_chunks(todo, 100), start=1):
            if source == "open-elevation":
                body = {"locations": [{"latitude": lat, "longitude": lon} for lat, lon in batch]}
                response = client.post(OPEN_ELEVATION_URL, json=body)
                response.raise_for_status()
                values = [float(r["elevation"]) for r in response.json()["results"]]
            else:
                params = {
                    "latitude": ",".join(f"{lat:.4f}" for lat, _ in batch),
                    "longitude": ",".join(f"{lon:.4f}" for _, lon in batch),
                }
                for _attempt in range(8):
                    response = client.get(OPEN_METEO_ELEVATION_URL, params=params)
                    if response.status_code != 429:
                        break
                    time.sleep(65)  # the free tier limits coordinates per minute
                response.raise_for_status()
                values = [float(v) for v in response.json()["elevation"]]
                time.sleep(8)
            for point, value in zip(batch, values):
                cache[_elevation_key(point)] = value
            cache["_source"] = source
            save()
            logger.info("elevation batch %d/%d", number, -(-len(todo) // 100))
    return source


def fetch_static(refresh: bool = False) -> dict[str, Path]:
    return {
        "kerala": download(KERALA_CSV_URL, RAW_DIR / "kerala.csv", refresh=refresh),
        "ifi": download(IFI_URL, RAW_DIR / "ifi_v3.csv", refresh=refresh),
        "geo2": download(GEOBOUNDARIES_ADM2_URL, RAW_DIR / "ind_adm2_simplified.geojson", refresh=refresh),
        "geo1": download(GEOBOUNDARIES_ADM1_URL, RAW_DIR / "ind_adm1_simplified.geojson", refresh=refresh),
        "census": download(CENSUS_URL, RAW_DIR / "census_2011_districts.csv", refresh=refresh),
    }


# ── clean: districts ───────────────────────────────────────────────────────


def district_shapes(geo2_path: Path, geo1_path: Path) -> tuple[pd.DataFrame, dict]:
    """Every geoBoundaries ADM2 district with its state, and the shapely geometries.

    ADM2 carries no state, so each district's representative point is placed in
    the ADM1 state polygons (nearest state when a coastal point falls outside).
    The unique label ``district`` is the name, with the state added in brackets
    when the name is used by more than one district.
    """
    from shapely.geometry import shape
    from shapely.strtree import STRtree

    states = json.loads(geo1_path.read_text(encoding="utf-8"))["features"]
    state_names = [strip_accents(f["properties"]["shapeName"]) for f in states]
    state_geoms = [shape(f["geometry"]) for f in states]
    tree = STRtree(state_geoms)

    rows, shapes = [], {}
    for feature in json.loads(geo2_path.read_text(encoding="utf-8"))["features"]:
        name = feature["properties"]["shapeName"].strip()
        if name.upper() == "DATA NOT AVAILABLE":   # geoBoundaries' placeholder polygon, not a district
            continue
        geom = shape(feature["geometry"])
        point = geom.representative_point()
        hits = [i for i in tree.query(point) if state_geoms[i].contains(point)]
        index = hits[0] if hits else int(tree.nearest(point))
        state = STATE_OVERRIDES.get(name, state_names[index])
        rows.append({"name": name, "state": state})
        shapes[len(rows) - 1] = geom
    frame = pd.DataFrame(rows)
    dup_in_state = frame.duplicated(["state", "name"], keep=False)
    if dup_in_state.any():
        raise ValueError("geoBoundaries repeats a district name inside a state: "
                         + ", ".join(sorted(set(frame[dup_in_state]["state"] + "/" + frame[dup_in_state]["name"]))))
    repeated = frame.duplicated("name", keep=False)
    frame["district"] = np.where(repeated, frame["name"] + " (" + frame["state"] + ")", frame["name"])
    return frame, {frame.loc[i, "district"]: geom for i, geom in shapes.items()}


def export_frontend_geo(districts: pd.DataFrame, shapes: dict, dest: Path = FRONTEND_GEO) -> Path:
    """Simplified polygons for the risk map, kept under ``GEO_MAX_BYTES``."""
    from shapely.geometry import mapping

    def rounded(coords, places):
        if isinstance(coords[0], (int, float)):
            return [round(coords[0], places), round(coords[1], places)]
        return [rounded(c, places) for c in coords]

    info = districts.set_index("district")
    tolerance, places = GEO_SIMPLIFY_DEG, 3
    while True:
        features = []
        for name, geom in shapes.items():
            simple = mapping(geom.simplify(tolerance, preserve_topology=True))
            features.append({
                "type": "Feature",
                "properties": {"district": name, "state": info.loc[name, "state"]},
                "geometry": {"type": simple["type"], "coordinates": rounded(simple["coordinates"], places)},
            })
        text = json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"))
        if len(text.encode("utf-8")) <= GEO_MAX_BYTES or tolerance > 0.1:
            break
        tolerance *= 1.5
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text, encoding="utf-8")
    logger.info("district polygons: %d features, %.2f MB, tolerance %.3f deg",
                len(features), len(text.encode("utf-8")) / 1e6, tolerance)
    return dest


def elevation_samples(shapes: dict) -> dict[str, list[tuple[float, float]]]:
    """A regular grid of points inside each district (at least one point).

    Spacing is ``ELEVATION_GRID_DEG`` for small districts and coarser for large
    ones, so no district needs more than about ``ELEVATION_MAX_SAMPLES`` points.
    """
    from shapely.geometry import Point
    from shapely.prepared import prep

    samples = {}
    for name, geom in shapes.items():
        minx, miny, maxx, maxy = geom.bounds
        spacing = max(ELEVATION_GRID_DEG, float(np.sqrt(geom.area / ELEVATION_MAX_SAMPLES)))
        inside = prep(geom)
        pts = [
            (round(lat, 4), round(lon, 4))
            for lat in np.arange(miny + spacing / 2, maxy, spacing)
            for lon in np.arange(minx + spacing / 2, maxx, spacing)
            if inside.contains(Point(lon, lat))
        ]
        c = geom.representative_point()
        samples[name] = pts or [(round(c.y, 4), round(c.x, 4))]
    return samples


def match_census(census_path: Path, districts: pd.DataFrame, index: DistrictIndex) -> tuple[pd.DataFrame, list[dict]]:
    """Census 2011 population and households per geoBoundaries district.

    Returns the census rows keyed by (state, name) of the matched district and
    a list of unmatched census rows. Two census rows that match one district
    are both reported and neither is used, rather than adding or picking one.
    """
    census = pd.read_csv(census_path)
    census = census.rename(columns={"State name": "cstate", "District name": "cname",
                                    "Population": "population", "Households": "households"})
    rows, unmatched = [], []
    for r in census.itertuples():
        match = index.find("census", r.cname, [r.cstate])
        if match.key is None:   # no match, or one census row standing for several districts
            unmatched.append({"source": "census", "state": r.cstate.title(), "name": r.cname,
                              "events": "", "kind": "unmatched"})
            continue
        rows.append({"state": match.key[0], "name": match.key[1], "population": int(r.population),
                     "households": int(r.households), "census_name": r.cname, "how": match.how})
    matched = pd.DataFrame(rows)
    clash = matched.duplicated(["state", "name"], keep=False)
    for r in matched[clash].itertuples():
        unmatched.append({"source": "census", "state": r.state, "name": r.census_name,
                          "events": "", "kind": "unmatched"})
    return matched[~clash].drop(columns=["census_name", "how"]), unmatched


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


def _start_choices(text: str) -> list[tuple[date, int]]:
    """Readings of a start date with their cost: 0 for day-first (IFI's usual style), 1 for month-first."""
    match = re.match(r"\s*(\d{1,2})-(\d{1,2})-(\d{4})", str(text))
    if not match:
        return []
    a, b, year = (int(g) for g in match.groups())
    choices: list[tuple[date, int]] = []
    for (day, month), cost in (((a, b), 0), ((b, a), 1)):
        try:
            reading = date(year, month, day)
        except ValueError:
            continue
        if all(reading != seen for seen, _ in choices):
            choices.append((reading, cost))
    return choices


ORDER_BREAK_COST = 10  # a reading that puts an event before the one numbered ahead of it: dearer than a few flips


def _pick_starts(choices: list[list[tuple[date, int]]], floor: date) -> list[date | None]:
    """The cheapest run of start dates for one year's events, in event-number order.

    Every event takes one of its readings. A month-first reading costs 1, and an
    event that starts before the one numbered ahead of it costs
    ``ORDER_BREAK_COST``, so the day-first reading stands unless it would break
    the date order that IFI's event numbers follow.
    """
    events = [c for c in choices if c]
    best: list[tuple[float, list[date]]] = [(0.0, [])]
    previous = [floor]
    for options in events:
        step: list[tuple[float, list[date]]] = []
        for reading, cost in options:
            candidates = [
                (total + cost + (ORDER_BREAK_COST if reading < previous[i] else 0), path)
                for i, (total, path) in enumerate(best)
            ]
            total, path = min(candidates, key=lambda item: item[0])
            step.append((total, path + [reading]))
        best = step
        previous = [reading for reading, _ in options]
    picked = iter(min(best, key=lambda item: item[0])[1]) if events else iter(())
    return [next(picked) if c else None for c in choices]


def resolve_ifi_dates(events: pd.DataFrame) -> pd.DataFrame:
    """Fix IFI's mixed day-first / month-first dates.

    IFI mostly writes dd-mm-yyyy, but some ambiguous dates are month-first: the
    main August 2018 Kerala event is stored as 08-01-2018 to 30-08-2018 with a
    30-day duration, i.e. 1-30 August. Event ids (UEI) are numbered in date
    order within a year and, in the all-India file, within each run of one
    state's events, so a run's start dates are chosen together: day-first unless
    that would put an event before the one numbered ahead of it, in which case
    the month-first reading that restores the order is used. Each end date takes
    the reading on or after the start that best matches the recorded duration.
    """
    events = events.copy()
    events["_seq"] = events["UEI"].str.extract(r"-(\d{4})-(\d{4})$").astype(int).apply(tuple, axis=1)
    events = events.sort_values("_seq")
    years = events["_seq"].map(lambda seq: seq[0])
    state = events["State"].fillna("") if "State" in events else pd.Series("", index=events.index)
    run = ((years != years.shift()) | (state != state.shift())).cumsum()   # one run per state block within a year
    starts: list[date | None] = []
    for _, block in events.groupby(run, sort=False):
        year = int(block["_seq"].iloc[0][0])
        starts += _pick_starts([_start_choices(t) for t in block["Start Date"]], date(year, 1, 1))
    ends = []
    for start, end_text, duration in zip(starts, events["End Date"], events["Duration(Days)"]):
        if start is None:
            ends.append(None)
            continue
        duration = None if pd.isna(duration) else float(duration)
        end_readings = [d for d in _date_readings(end_text) if d >= start] or [start]
        if duration:
            ends.append(min(end_readings, key=lambda d: abs((d - start).days + 1 - duration)))
        else:
            ends.append(end_readings[0])
    events["start"] = pd.to_datetime(pd.Series(starts, index=events.index))
    events["end"] = pd.to_datetime(pd.Series(ends, index=events.index))
    return events.drop(columns="_seq")


def clean_ifi(path: Path, index: DistrictIndex) -> tuple[pd.DataFrame, list[dict], dict]:
    """IFI events, one row per event x matched district.

    Returns the rows, the district names that could not be matched (with the
    number of events that listed them) and counts for the build log.
    """
    ifi = pd.read_csv(path, encoding="latin-1")
    ifi = resolve_ifi_dates(ifi[["UEI", "Start Date", "End Date", "Duration(Days)", "Districts", "State",
                                 "Human fatality"]])
    ifi["deaths"] = pd.to_numeric(ifi["Human fatality"], errors="coerce")
    ifi["duration_days"] = pd.to_numeric(ifi["Duration(Days)"], errors="coerce")
    rows: list[dict] = []
    missed: dict[tuple[str, str, str], int] = {}
    stats = {"events": int(len(ifi)), "no_district_listed": 0, "no_date": 0, "names": 0}
    methods: dict[str, int] = {}
    for _, event in ifi.iterrows():
        listed = split_districts(event["Districts"])
        if pd.isna(event["start"]):
            stats["no_date"] += 1
            continue
        if not listed:
            stats["no_district_listed"] += 1
            continue
        states = split_states(event["State"]) if isinstance(event["State"], str) else []
        seen = set()
        for name in listed:
            match = index.find("ifi", name, states)
            stats["names"] += 1
            methods[match.how] = methods.get(match.how, 0) + 1
            if not match.keys:
                kind = {"description": "not_a_district", "no_polygon": "no_polygon"}.get(match.how, "unmatched")
                key = (kind, (states[0] if states else ""), name)
                missed[key] = missed.get(key, 0) + 1
                continue
            for target in match.keys:
                if target in seen:
                    continue
                seen.add(target)
                rows.append({
                    "uei": event["UEI"],
                    "state": target[0],
                    "name": target[1],
                    "start": event["start"].date().isoformat(),
                    "end": event["end"].date().isoformat(),
                    "year": int(event["start"].year),
                    "month": int(event["start"].month),
                    "duration_days": event["duration_days"],
                    "deaths": event["deaths"],
                })
    unmatched = [{"source": "ifi", "state": state, "name": name, "events": n, "kind": kind}
                 for (kind, state, name), n in sorted(missed.items())]
    stats["match_methods"] = dict(sorted(methods.items()))
    return pd.DataFrame(rows), unmatched, stats


def month_labels(events: pd.DataFrame, districts: list[str], first_year: int, last_year: int) -> pd.DataFrame:
    """District x calendar month: did IFI record a flood event touching the district?

    ``flood``    an IFI event that lists the district overlaps the month. This is
                 the training label.
    ``deadly``   one of those events recorded at least one death (context only).

    A multi-district event is one record with one death toll, so it counts for
    every district it lists.
    """
    rows = []
    for e in events.itertuples():
        for period in pd.period_range(e.start, e.end, freq="M"):
            if first_year <= period.year <= last_year:
                rows.append((e.district, period.year, period.month, e.uei, e.deaths))
    hits = pd.DataFrame(rows, columns=["district", "year", "month", "uei", "deaths"])
    grid = pd.MultiIndex.from_product(
        [districts, range(first_year, last_year + 1), MONTHS], names=["district", "year", "month"]
    ).to_frame(index=False)
    if hits.empty:
        agg = pd.DataFrame(columns=["district", "year", "month", "events", "deadly", "event_deaths"])
    else:
        agg = hits.groupby(["district", "year", "month"]).apply(
            lambda g: pd.Series({
                "events": g["uei"].nunique(),
                "deadly": int((g["deaths"] >= 1).any()),
                "event_deaths": g.drop_duplicates("uei")["deaths"].sum(min_count=1),
            }), include_groups=False,
        ).reset_index()
    out = grid.merge(agg, on=["district", "year", "month"], how="left")
    out["events"] = out["events"].fillna(0).astype(int)
    out["flood"] = (out["events"] > 0).astype(int)
    out["deadly"] = out["deadly"].fillna(0).astype(int)
    out["event_deaths"] = out["event_deaths"].astype(float)
    return out


def prior_rate(labels: pd.DataFrame, district: str, year: int, window: int = PRIOR_WINDOW) -> float:
    """Share of the district's previous ``window`` IFI years with a recorded flood.

    Uses only years before ``year`` that IFI covers, so a training row never
    sees its own label.
    """
    last = min(year - 1, IFI_LAST_YEAR)
    rows = labels[(labels["district"] == district) & labels["year"].between(last - window + 1, last)]
    seasons = rows.groupby("year")["flood"].max()
    return float(seasons.mean()) if len(seasons) else float("nan")


def prior_rates(labels: pd.DataFrame, years: range, window: int = PRIOR_WINDOW) -> pd.DataFrame:
    """``prior_rate`` for every district and year at once (same rule, vectorised)."""
    yearly = labels.groupby(["district", "year"])["flood"].max().unstack("year")
    first, last = int(yearly.columns.min()), int(yearly.columns.max())
    out = {}
    for year in years:
        end = min(year - 1, last)
        start = max(end - window + 1, first)
        out[year] = yearly.loc[:, start:end].mean(axis=1) if end >= start else pd.Series(np.nan, index=yearly.index)
    table = pd.DataFrame(out)
    table.index.name, table.columns.name = "district", "year"
    return table.stack().rename("prior_flood_rate").reset_index()


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
    pct = total / normal * 100 if normal > 0 else float("nan")
    return {
        "days": int(rain.notna().sum()),
        "rain_mm": round(total, 1),
        "normal_mm": round(normal, 1),
        "rain_pct_normal": round(min(pct, MAX_RAIN_PCT), 1),
        "max_3day_rain_mm": round(float(rain.rolling(3, min_periods=3).sum().max()), 1),
        "soil_wetness_before": round(float(before.mean()), 3),
    }


def month_features(daily: pd.DataFrame, last_year: int) -> pd.DataFrame:
    """Features for every calendar month 1981..``last_year`` of one grid cell.

    The same numbers ``window_features`` gives for each month, computed for all
    months at once: the month's rain total against its 1991-2020 mean, its
    heaviest 3 days (windows never span two months), and the mean soil
    wetness of the 7 days before the 1st.
    """
    d = daily.loc[:f"{last_year}-12-31"]
    year, month = d.index.year, d.index.month
    total = d["rain_mm"].groupby([year, month]).sum(min_count=1)
    days = d["rain_mm"].groupby([year, month]).count()
    three = d["rain_mm"].rolling(3, min_periods=3).sum().where(d.index.day >= 3)
    peak = three.groupby([year, month]).max()
    before = d["soil_wetness"].rolling(ANTECEDENT_DAYS, min_periods=1).mean().shift(1)
    soil = before[d.index.day == 1]
    soil.index = pd.MultiIndex.from_arrays([soil.index.year, soil.index.month])
    out = pd.DataFrame({"rain_mm": total, "days": days, "max_3day_rain_mm": peak, "soil_wetness_before": soil})
    out.index.names = ["year", "month"]
    years = out.index.get_level_values("year")
    normal = out[(years >= NORMAL_YEARS[0]) & (years <= NORMAL_YEARS[1])]["rain_mm"].groupby("month").mean().rename("normal_mm")
    out = out.join(normal, on="month")
    pct = (out["rain_mm"] / out["normal_mm"] * 100).where(out["normal_mm"] > 0)
    out["rain_pct_normal"] = pct.clip(upper=MAX_RAIN_PCT)
    return out.reset_index()


# ── build ──────────────────────────────────────────────────────────────────


def _write_report(rows: list[dict], directory: Path) -> pd.DataFrame:
    report = pd.DataFrame(rows, columns=["source", "state", "name", "events", "kind"])
    report.to_csv(directory / "unmatched_names.csv", index=False)
    return report


def build(refresh: bool = False, current_only: bool = False, today: date | None = None,
          states: list[str] | None = None) -> dict:
    today = today or datetime.now(timezone.utc).date()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    CLEAN_DIR.mkdir(parents=True, exist_ok=True)
    out_dir = PARTIAL_DIR if states else CLEAN_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = fetch_static(refresh=refresh and not current_only)

    # Districts: the geoBoundaries list, with state, census and IFI matched by name inside the state.
    all_districts, all_shapes = district_shapes(paths["geo2"], paths["geo1"])
    aliases = load_aliases(ALIASES_PATH)
    index = DistrictIndex(all_districts, aliases)

    census, unmatched = match_census(paths["census"], all_districts, index)
    events_all, ifi_unmatched, ifi_stats = clean_ifi(paths["ifi"], index)
    unmatched += ifi_unmatched
    logger.info("IFI: %s", ifi_stats)

    all_districts = all_districts.merge(census, on=["state", "name"], how="left")
    events_all = events_all.merge(all_districts[["state", "name", "district"]], on=["state", "name"], how="left")

    if states:
        wanted = {canon_state(s) for s in states}
        known = {canon_state(s) for s in all_districts["state"]}
        if wanted - known:
            raise SystemExit(f"unknown state(s): {', '.join(sorted(wanted - known))}. "
                             f"Known: {', '.join(sorted(known))}")
        all_districts = all_districts[all_districts["state"].map(canon_state).isin(wanted)].reset_index(drop=True)
    else:
        all_districts = all_districts.reset_index(drop=True)
    shapes = {name: all_shapes[name] for name in all_districts["district"]}
    names = list(all_districts["district"])
    events = events_all[events_all["district"].isin(names)]

    no_census = all_districts[all_districts["population"].isna()]
    report_rows = unmatched + [
        {"source": "geoboundaries", "state": r.state, "name": r.name, "events": "", "kind": "no_census_row"}
        for r in no_census.itertuples()]
    report = _write_report(report_rows, out_dir)
    logger.info("districts %d; census rows missing for %d; unmatched names %d",
                len(all_districts), len(no_census), int((report["kind"] == "unmatched").sum()))

    # Elevation: sample points inside each district, cached point by point.
    samples = elevation_samples(shapes)
    flat = sorted({p for name in names for p in samples[name]})
    cache_path = RAW_DIR / "elevation_points.json"
    cache: dict = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() and not refresh else {}
    logger.info("elevation: %d sample points, %d already cached", len(flat),
                sum(_elevation_key(p) in cache for p in flat))
    elevation_source = fetch_elevations(
        flat, cache, lambda: cache_path.write_text(json.dumps(cache), encoding="utf-8"))
    rows = []
    for name in names:
        geom = shapes[name]
        elev = np.array([cache[_elevation_key(p)] for p in samples[name]])
        centroid = geom.representative_point()
        area_km2 = geom.area * (111.32 ** 2) * np.cos(np.radians(centroid.y))
        cell = power_cell(centroid.y, centroid.x)
        rows.append({
            "district": name,
            "lat": round(centroid.y, 4),
            "lon": round(centroid.x, 4),
            "power_lat": cell[0],
            "power_lon": cell[1],
            "area_km2": round(float(area_km2)),
            "elevation_m": round(float(elev.mean()), 1),
            "elevation_median_m": round(float(np.median(elev)), 1),
            "low_lying_pct": round(float((elev < LOW_LYING_M).mean() * 100), 1),
            "elevation_samples": len(elev),
        })
    districts = all_districts.rename(columns={"name": "district_name"}).merge(
        pd.DataFrame(rows), on="district")
    districts = districts.rename(columns={"district_name": "name"})
    if not states:
        export_frontend_geo(districts, shapes)

    # NASA POWER daily series, one request per unique grid cell, 1981 to yesterday.
    end = today - timedelta(days=1)
    cells = sorted({(r.power_lat, r.power_lon) for r in districts.itertuples()})
    logger.info("NASA POWER: %d districts in %d grid cells", len(districts), len(cells))
    with ThreadPoolExecutor(max_workers=POWER_WORKERS) as pool:
        list(pool.map(lambda c: fetch_power(c, end=end, refresh=refresh or current_only), cells))

    # Labels and history from IFI, 1967-2023, all twelve months.
    labels = month_labels(events, names, first_year=IFI_FIRST_YEAR, last_year=IFI_LAST_YEAR)
    yearly = labels.groupby(["district", "year"]).agg(flood=("flood", "max"), deadly=("deadly", "max"))
    history = yearly.groupby("district").agg(
        ifi_seasons=("flood", "size"),
        ifi_flood_seasons=("flood", "sum"),
        ifi_deadly_seasons=("deadly", "sum"),
    ).reset_index()
    history["ifi_first_year"] = IFI_FIRST_YEAR
    districts = districts.merge(history, on="district")
    priors = prior_rates(labels, range(POWER_START.year, IFI_LAST_YEAR + 1))

    # Feature tables per cell, then mapped back to the districts in the cell.
    month_frames, current_rows = [], []
    last_days = []
    daily_by_cell = {}
    for cell in cells:
        daily = load_power(_power_path(cell))
        daily_by_cell[cell] = daily
        feats = month_features(daily, IFI_LAST_YEAR)
        feats = feats[feats["year"] >= POWER_START.year]
        feats.insert(0, "power_lat", cell[0])
        feats.insert(1, "power_lon", cell[1])
        month_frames.append(feats)
        last = daily["rain_mm"].last_valid_index()
        last_days.append(last)
        first = last - pd.Timedelta(days=CURRENT_WINDOW_DAYS - 1)
        current_rows.append({"power_lat": cell[0], "power_lon": cell[1],
                             "window_start": first.date().isoformat(), "as_of": last.date().isoformat(),
                             **window_features(daily, first, last)})
    cell_months = pd.concat(month_frames, ignore_index=True)
    info = districts[["district", "state", "power_lat", "power_lon", "elevation_m"]]
    months = info.merge(cell_months, on=["power_lat", "power_lon"])
    months = months.merge(priors, on=["district", "year"], how="left")
    months = months.merge(labels[["district", "year", "month", "events", "event_deaths", "deadly", "flood"]],
                          on=["district", "year", "month"], how="left")
    months = months.drop(columns=["power_lat", "power_lon"])
    months["prior_flood_rate"] = months["prior_flood_rate"].round(3)
    for col in ("rain_mm", "max_3day_rain_mm", "normal_mm", "rain_pct_normal"):
        months[col] = months[col].round(1)
    months["soil_wetness_before"] = months["soil_wetness_before"].round(3)
    months = months.sort_values(["district", "year", "month"]).reset_index(drop=True)

    # Current conditions: the latest CURRENT_WINDOW_DAYS days of POWER data.
    latest = last_days and max(last_days)
    prior_now = prior_rates(labels, [min(latest.year, IFI_LAST_YEAR + 1)]).drop(columns="year")
    current = info.drop(columns="elevation_m").merge(pd.DataFrame(current_rows), on=["power_lat", "power_lon"])
    current = current.merge(districts[["district", "elevation_m"]], on="district").merge(prior_now, on="district")
    current = current.drop(columns=["power_lat", "power_lon"])
    current["prior_flood_rate"] = current["prior_flood_rate"].round(3)

    # The Kerala dataset as published (state level), plus POWER's mean over Kerala's districts.
    kerala = pd.read_csv(paths["kerala"])
    kerala.columns = [c.strip().lower().replace(" ", "_") for c in kerala.columns]
    kerala = kerala.drop(columns=["subdivision"])
    kerala["floods"] = (kerala["floods"].str.strip().str.upper() == "YES").astype(int)
    kerala_cells = sorted({(r.power_lat, r.power_lon) for r in districts.itertuples()
                           if canon_state(r.state) == canon_state(KERALA_STATE)})
    if kerala_cells:
        power_annual = pd.concat(
            [daily_by_cell[c]["rain_mm"].groupby(daily_by_cell[c].index.year).sum() for c in kerala_cells], axis=1
        ).mean(axis=1).rename("power_annual_rainfall_mm")
        kerala = kerala.merge(power_annual.round(1), left_on="year", right_index=True, how="left")

    districts = districts.sort_values(["state", "district"]).reset_index(drop=True)
    districts.to_csv(out_dir / "districts.csv", index=False)
    months.to_csv(out_dir / "months.csv.gz", index=False)
    current.to_csv(out_dir / "current.csv", index=False)
    kerala.to_csv(out_dir / "kerala_imd.csv", index=False)
    events.drop(columns=["name"]).to_csv(out_dir / "ifi_events.csv", index=False)
    for stale in ("seasons.csv", "months.csv", "ifi_kerala_events.csv"):
        if (out_dir / stale).exists():
            (out_dir / stale).unlink()
    meta = {
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "region": "India",
        "states": sorted(districts["state"].unique()),
        "districts": int(len(districts)),
        "power_cells": len(cells),
        "elevation_source": elevation_source,
        "power_first_day": POWER_START.isoformat(),
        "power_last_day": max(last_days).date().isoformat(),
        "training_years": [POWER_START.year, IFI_LAST_YEAR],
        "months": list(MONTHS),
        "normal_period": list(NORMAL_YEARS),
        "current_window_days": CURRENT_WINDOW_DAYS,
        "ifi_last_year": IFI_LAST_YEAR,
        "ifi": ifi_stats,
        "districts_without_census": int(len(no_census)),
        "unmatched_names": int((report["kind"] == "unmatched").sum()),
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    logger.info("districts %d, district-months %d (flood rate %.4f), current window %s to %s, elevation from %s",
                len(districts), len(months), months["flood"].mean(),
                current["window_start"].min(), current["as_of"].max(), elevation_source)
    return {"districts": districts, "months": months, "current": current, "kerala": kerala,
            "events": events, "meta": meta, "report": report}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--refresh", action="store_true", help="re-download every source")
    parser.add_argument("--current", action="store_true", help="re-fetch the latest NASA POWER data only")
    parser.add_argument("--states", help="comma-separated states to build, e.g. Kerala,Assam "
                                         "(writes to clean/flood/partial/, leaving the committed data alone)")
    args = parser.parse_args(argv)
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    use_system_trust_store()
    states = [s.strip() for s in args.states.split(",") if s.strip()] if args.states else None
    build(refresh=args.refresh, current_only=args.current, states=states)
    return 0


if __name__ == "__main__":
    sys.exit(main())
