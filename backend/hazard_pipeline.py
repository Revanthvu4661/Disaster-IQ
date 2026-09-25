"""Earthquake and cyclone hazard metrics for the states and union territories of India.

    python -m backend.hazard_pipeline            # use cached raw files, download missing
    python -m backend.hazard_pipeline --refresh  # re-download the boundaries and census

Inputs (details in docs/DATA_SOURCES.md):

1. USGS ComCat M6.0+ earthquakes (``backend/data/clean/earthquakes_usgs.csv``,
   built by ``backend/data_pipeline.py``), 1950 onwards.
2. NOAA IBTrACS v04r01 tracks since 1980 (``backend/data/raw/ibtracs...csv``,
   fetched by ``backend/data_pipeline.py``), 6-hourly points.
3. geoBoundaries IND ADM1 (state and union territory polygons, ODbL).
4. Census of India 2011 district table (population), summed to today's states.

For each region the pipeline counts what the catalogues record near it:

* earthquakes: events of M6.0+ whose epicentre is inside the region or within
  ``EQ_RADIUS_KM`` of its boundary, 1950-2025;
* cyclones: storms whose track came within ``CYCLONE_RADIUS_KM`` of the region
  while at least ``TROPICAL_STORM_KT`` (34 kt); of those, storms that reached
  ``HURRICANE_KT`` (64 kt) while that near, 1980-2025.

No risk level is decided here; ``backend/services/hazard_risk.py`` turns these
counts into annual probabilities and levels.

Outputs (committed): ``backend/data/clean/hazard/{regions,eq_events,cyclone_storms}.csv``,
``meta.json`` and ``frontend/public/geo/india-states.json``.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import shapely

from backend.config import DATA_DIR
from backend.data_pipeline import IBTRACS_URL, download, use_system_trust_store

logger = logging.getLogger("hazard_pipeline")

RAW_DIR = DATA_DIR / "raw"
FLOOD_RAW = RAW_DIR / "flood"
CLEAN_DIR = DATA_DIR / "clean" / "hazard"
FRONTEND_GEO = DATA_DIR.parent.parent / "frontend" / "public" / "geo" / "india-states.json"

ADM1_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM1/"
    "geoBoundaries-IND-ADM1_simplified.geojson"
)
CENSUS_URL = (
    "https://raw.githubusercontent.com/nishusharma1608/India-Census-2011-Analysis/master/"
    "india-districts-census-2011.csv"
)

EQ_FIRST_YEAR = 1950            # global M6+ catalogues are reasonably complete from about 1950
EQ_LAST_YEAR = 2025
EQ_MIN_MAGNITUDE = 6.0
EQ_RADIUS_KM = 300
CYCLONE_FIRST_SEASON = 1980     # IBTrACS file starts in 1980
CYCLONE_LAST_SEASON = 2025
CYCLONE_RADIUS_KM = 100
TROPICAL_STORM_KT = 34
HURRICANE_KT = 64               # Saffir-Simpson category 1
TOP_EARTHQUAKES = 10            # strongest events kept per region
SEGMENT_DEG = 0.05              # boundary densified to about 5 km before measuring distance
INDIA_BOX = (0.0, 40.0, 55.0, 105.0)  # lat min, lat max, lon min, lon max: keeps the North Indian Ocean

#: Census 2011 states that were later split; their districts are re-assigned by name.
TELANGANA_DISTRICTS = {"Adilabad", "Nizamabad", "Karimnagar", "Medak", "Hyderabad", "Rangareddy",
                       "Mahbubnagar", "Nalgonda", "Warangal", "Khammam"}
LADAKH_DISTRICTS = {"Leh(Ladakh)", "Kargil"}
CENSUS_TO_REGION = {
    "ORISSA": "Odisha", "PONDICHERRY": "Puducherry", "NCT OF DELHI": "Delhi",
    "DADRA AND NAGAR HAVELI": "Dadra and Nagar Haveli and Daman and Diu",
    "DAMAN AND DIU": "Dadra and Nagar Haveli and Daman and Diu",
}
INDIA_POPULATION_2011 = 1_210_854_977


def plain(text: str) -> str:
    """'Gujarāt' -> 'Gujarat'."""
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = (np.radians(np.asarray(a, dtype=float)) for a in (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 6371.0088 * 2 * np.arcsin(np.sqrt(a))


class Region:
    """A polygon with a distance-in-km function for arrays of points."""

    def __init__(self, name: str, geometry):
        self.name = name
        self.geometry = geometry
        self.boundary = shapely.get_coordinates(shapely.segmentize(geometry, SEGMENT_DEG))  # (lon, lat)
        self.bounds = geometry.bounds

    def distance_km(self, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
        """0 inside the region, else the distance to the nearest boundary vertex (about 5 km spacing)."""
        lat = np.asarray(lat, dtype=float)
        lon = np.asarray(lon, dtype=float)
        out = np.full(lat.shape, np.inf)
        inside = shapely.contains_xy(self.geometry, lon, lat)
        out[inside] = 0.0
        outside = ~inside
        if outside.any():
            d = haversine_km(lat[outside][:, None], lon[outside][:, None],
                             self.boundary[:, 1][None, :], self.boundary[:, 0][None, :])
            out[outside] = d.min(axis=1)
        return out


def load_regions(path: Path) -> dict[str, Region]:
    features = json.loads(path.read_text(encoding="utf-8"))["features"]
    return {plain(f["properties"]["shapeName"]): Region(plain(f["properties"]["shapeName"]),
                                                         shapely.geometry.shape(f["geometry"]))
            for f in features}


def state_populations(census_path: Path, region_names: list[str]) -> pd.Series:
    census = pd.read_csv(census_path)

    def region_of(row) -> str:
        district, state = row["District name"], row["State name"]
        if state == "ANDHRA PRADESH" and district in TELANGANA_DISTRICTS:
            return "Telangana"
        if state == "JAMMU AND KASHMIR" and district in LADAKH_DISTRICTS:
            return "Ladakh"
        if state in CENSUS_TO_REGION:
            return CENSUS_TO_REGION[state]
        return state.title().replace(" And ", " and ")

    census["region"] = census.apply(region_of, axis=1)
    pop = census.groupby("region")["Population"].sum()
    if int(pop.sum()) != INDIA_POPULATION_2011:
        raise ValueError(f"census districts sum to {int(pop.sum()):,}, not India's {INDIA_POPULATION_2011:,}")
    missing = [n for n in region_names if n not in pop.index]
    if missing:
        raise ValueError(f"no census population for: {', '.join(missing)}")
    return pop


# ── earthquakes ────────────────────────────────────────────────────────────


def earthquake_metrics(regions: dict[str, Region], catalog: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    quakes = catalog[(catalog["year"].between(EQ_FIRST_YEAR, EQ_LAST_YEAR))
                     & (catalog["magnitude"] >= EQ_MIN_MAGNITUDE)].reset_index(drop=True)
    pad = EQ_RADIUS_KM / 111.0 * 1.4
    rows, events = [], []
    for name, region in regions.items():
        minx, miny, maxx, maxy = region.bounds
        near = quakes[quakes["latitude"].between(miny - pad, maxy + pad)
                      & quakes["longitude"].between(minx - pad * 1.6, maxx + pad * 1.6)]
        dist = region.distance_km(near["latitude"].to_numpy(), near["longitude"].to_numpy())
        hit = near[dist <= EQ_RADIUS_KM].assign(dist_km=dist[dist <= EQ_RADIUS_KM].round(0))
        years = EQ_LAST_YEAR - EQ_FIRST_YEAR + 1
        strongest = hit.sort_values(["magnitude", "year"], ascending=[False, True]).head(1)
        rows.append({
            "region": name,
            "eq_events_m6": int(len(hit)),
            "eq_events_m7": int((hit["magnitude"] >= 7.0).sum()),
            "eq_rate_per_year": round(len(hit) / years, 4),
            "eq_max_magnitude": float(strongest["magnitude"].iloc[0]) if len(strongest) else None,
            "eq_max_year": int(strongest["year"].iloc[0]) if len(strongest) else None,
            "eq_max_place": strongest["place"].iloc[0] if len(strongest) else None,
            "eq_inside_events": int((hit["dist_km"] == 0).sum()),
        })
        top = hit.sort_values(["magnitude", "year"], ascending=[False, True]).head(TOP_EARTHQUAKES)
        for r in top.itertuples():
            events.append({"region": name, "time": r.time[:10], "year": int(r.year), "magnitude": float(r.magnitude),
                           "place": r.place, "dist_km": float(r.dist_km)})
    return pd.DataFrame(rows), pd.DataFrame(events)


# ── cyclones ───────────────────────────────────────────────────────────────


def load_tracks(path: Path) -> pd.DataFrame:
    """North Indian Ocean 6-hourly points: position and the best available wind (kt)."""
    usecols = ["SID", "SEASON", "BASIN", "NAME", "ISO_TIME", "LAT", "LON", "TRACK_TYPE", "USA_WIND", "WMO_WIND"]
    chunks = []
    for chunk in pd.read_csv(path, usecols=usecols, skiprows=[1], chunksize=200_000, low_memory=False,
                             na_values=[" ", ""]):
        chunk = chunk[chunk["BASIN"] == "NI"]
        if len(chunk):
            chunks.append(chunk)
    tracks = pd.concat(chunks, ignore_index=True)
    tracks = tracks[tracks["TRACK_TYPE"].astype(str).str.lower() == "main"].copy()
    for col in ("LAT", "LON", "USA_WIND", "WMO_WIND"):
        tracks[col] = pd.to_numeric(tracks[col], errors="coerce")
    tracks["wind_kt"] = tracks["USA_WIND"].fillna(tracks["WMO_WIND"])
    tracks["wind_source"] = np.where(tracks["USA_WIND"].notna(), "US agencies (1-min)", "IMD (3-min)")
    lat_min, lat_max, lon_min, lon_max = INDIA_BOX
    tracks = tracks[tracks["LAT"].between(lat_min, lat_max) & tracks["LON"].between(lon_min, lon_max)]
    return tracks.dropna(subset=["LAT", "LON", "wind_kt"]).reset_index(drop=True)


def cyclone_metrics(regions: dict[str, Region], tracks: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    pad = CYCLONE_RADIUS_KM / 111.0 * 1.4
    rows, storms = [], []
    seasons = CYCLONE_LAST_SEASON - CYCLONE_FIRST_SEASON + 1
    tracks = tracks[tracks["SEASON"].between(CYCLONE_FIRST_SEASON, CYCLONE_LAST_SEASON)]
    for name, region in regions.items():
        minx, miny, maxx, maxy = region.bounds
        near = tracks[tracks["LAT"].between(miny - pad, maxy + pad)
                      & tracks["LON"].between(minx - pad * 1.6, maxx + pad * 1.6)]
        dist = region.distance_km(near["LAT"].to_numpy(), near["LON"].to_numpy())
        close = near[dist <= CYCLONE_RADIUS_KM].assign(dist_km=dist[dist <= CYCLONE_RADIUS_KM])
        strong = close[close["wind_kt"] >= TROPICAL_STORM_KT]
        if len(strong):
            peak = strong.loc[strong.groupby("SID")["wind_kt"].idxmax()]
            closest = strong.groupby("SID")["dist_km"].min()
            per_storm = pd.DataFrame({
                "sid": peak["SID"].to_numpy(), "name": peak["NAME"].to_numpy(),
                "season": peak["SEASON"].astype(int).to_numpy(), "max_wind_kt": peak["wind_kt"].to_numpy(),
                "min_dist_km": closest.loc[peak["SID"]].to_numpy(), "wind_source": peak["wind_source"].to_numpy(),
            })
        else:
            per_storm = pd.DataFrame(columns=["sid", "name", "season", "max_wind_kt", "min_dist_km", "wind_source"])
        top = per_storm.sort_values(["max_wind_kt", "season"], ascending=[False, True]).head(1)
        rows.append({
            "region": name,
            "cy_storms_ts": int(len(per_storm)),
            "cy_storms_hurricane": int((per_storm["max_wind_kt"] >= HURRICANE_KT).sum()) if len(per_storm) else 0,
            "cy_rate_ts_per_year": round(len(per_storm) / seasons, 4),
            "cy_rate_hurricane_per_year": round(
                float((per_storm["max_wind_kt"] >= HURRICANE_KT).sum()) / seasons, 4) if len(per_storm) else 0.0,
            "cy_max_wind_kt": float(top["max_wind_kt"].iloc[0]) if len(top) else None,
            "cy_max_name": top["name"].iloc[0] if len(top) else None,
            "cy_max_season": int(top["season"].iloc[0]) if len(top) else None,
        })
        for r in per_storm.itertuples():
            storms.append({"region": name, "sid": r.sid, "name": r.name,
                           "season": r.season, "max_wind_kt": r.max_wind_kt,
                           "min_dist_km": round(r.min_dist_km), "wind_source": r.wind_source})
    return pd.DataFrame(rows), pd.DataFrame(storms)


# ── output ─────────────────────────────────────────────────────────────────


def export_geo(regions: dict[str, Region], dest: Path = FRONTEND_GEO) -> Path:
    def rounded(coords):
        if isinstance(coords[0], (int, float)):
            return [round(coords[0], 3), round(coords[1], 3)]
        return [rounded(c) for c in coords]

    features = []
    for name, region in regions.items():
        simple = shapely.geometry.mapping(region.geometry.simplify(0.02, preserve_topology=True))
        features.append({"type": "Feature", "properties": {"region": name},
                         "geometry": {"type": simple["type"], "coordinates": rounded(simple["coordinates"])}})
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")),
                    encoding="utf-8")
    return dest


def build(refresh: bool = False) -> dict:
    CLEAN_DIR.mkdir(parents=True, exist_ok=True)
    adm1 = download(ADM1_URL, FLOOD_RAW / "ind_adm1_simplified.geojson", refresh=refresh)
    census = download(CENSUS_URL, FLOOD_RAW / "census_2011_districts.csv", refresh=refresh)
    ibtracs = download(IBTRACS_URL, RAW_DIR / "ibtracs.since1980.list.v04r01.csv", parts=32)
    regions = load_regions(adm1)
    population = state_populations(census, list(regions))

    catalog = pd.read_csv(DATA_DIR / "clean" / "earthquakes_usgs.csv")
    eq, eq_events = earthquake_metrics(regions, catalog)
    cy, cy_storms = cyclone_metrics(regions, load_tracks(ibtracs))

    info = pd.DataFrame([{
        "region": name,
        "lat": round(r.geometry.representative_point().y, 3),
        "lon": round(r.geometry.representative_point().x, 3),
        "area_km2": round(r.geometry.area * 111.32 ** 2 * np.cos(np.radians(r.geometry.centroid.y))),
        "population": int(population[name]),
    } for name, r in regions.items()])
    table = info.merge(eq, on="region").merge(cy, on="region").sort_values("region")
    table.to_csv(CLEAN_DIR / "regions.csv", index=False)
    eq_events.to_csv(CLEAN_DIR / "eq_events.csv", index=False)
    cy_storms.to_csv(CLEAN_DIR / "cyclone_storms.csv", index=False)
    export_geo(regions)
    meta = {
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "regions": len(table),
        "earthquake": {"first_year": EQ_FIRST_YEAR, "last_year": EQ_LAST_YEAR, "min_magnitude": EQ_MIN_MAGNITUDE,
                       "radius_km": EQ_RADIUS_KM, "events_in_catalogue": int(
                           catalog["year"].between(EQ_FIRST_YEAR, EQ_LAST_YEAR).sum())},
        "cyclone": {"first_season": CYCLONE_FIRST_SEASON, "last_season": CYCLONE_LAST_SEASON,
                    "radius_km": CYCLONE_RADIUS_KM, "tropical_storm_kt": TROPICAL_STORM_KT,
                    "hurricane_kt": HURRICANE_KT, "basin": "North Indian Ocean"},
    }
    (CLEAN_DIR / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    logger.info("%d regions; %d earthquake rows, %d storm rows", len(table), len(eq_events), len(cy_storms))
    return {"regions": table, "eq_events": eq_events, "cyclone_storms": cy_storms, "meta": meta}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--refresh", action="store_true", help="re-download boundaries and census")
    args = parser.parse_args(argv)
    logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    use_system_trust_store()
    build(refresh=args.refresh)
    return 0


if __name__ == "__main__":
    sys.exit(main())
