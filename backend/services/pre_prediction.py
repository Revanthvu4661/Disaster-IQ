"""Pre-Prediction: the historical inputs of the short-range risk outlook.

The Pre-Prediction page combines four factors per hazard into a 0-100 risk
score (the formula runs in the browser, frontend/src/lib/prePrediction.js):

    score = (historical frequency x 0.35 + seasonal factor x 0.25
             + live weather anomaly x 0.30 + geographic vulnerability x 0.10) x 100

This module serves the three factors that come from the project's own data,
each scaled to 0-1, plus the same-season event counts of the last ten years.
The live anomaly comes from Open-Meteo and USGS, fetched by the page itself.

Sources (all already in backend/data/clean/):
    floods       India Flood Inventory event dates, 1967-2023, per state
    cyclones     NOAA IBTrACS storms whose track centre passed within 100 km of
                 the state, 1981-2024 (month from the storm's genesis date)
    earthquakes  USGS M6.0+ epicentres within 300 km of the state, 1950-2025
    geography    district elevation (share of land below 10 m) and the
                 historical maximum magnitude near each state

This is a heuristic outlook, not a trained or validated model: the weights
are fixed judgements, and every factor is relative to the most-exposed state.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from typing import Any

import httpx
import pandas as pd

from backend.config import DATA_DIR, get_settings

logger = logging.getLogger("disasteriq.pre_prediction")

CLEAN = DATA_DIR / "clean"
HISTORY_YEARS = 10

#: IFI state names that differ from today's 36 states and union territories.
IFI_ALIASES = {
    "Andaman & Nicobar Islands": "Andaman and Nicobar Islands",
    "Dadar&Nagar Haveli": "Dadra and Nagar Haveli and Daman and Diu",
    "Dadra and Nagar Haveli": "Dadra and Nagar Haveli and Daman and Diu",
    "Daman": "Dadra and Nagar Haveli and Daman and Diu",
    "Daman & Diu": "Dadra and Nagar Haveli and Daman and Diu",
    "Daman and Diu": "Dadra and Nagar Haveli and Daman and Diu",
    "Diu": "Dadra and Nagar Haveli and Daman and Diu",
    "East Rajasthan": "Rajasthan",
    "Jammu & Kashmir": "Jammu and Kashmir",
    "Madras": "Tamil Nadu",
    "New Delhi": "Delhi",
    "Parts of Maharashtra": "Maharashtra",
    "Uttar pradesh": "Uttar Pradesh",
}

#: States and UTs with a sea coast, and the open-sea point whose surface
#: temperature stands for "cyclone fuel" off that coast.
BAY_OF_BENGAL = (15.0, 87.0)
ARABIAN_SEA = (15.0, 68.0)
ANDAMAN_SEA = (11.0, 95.0)
LACCADIVE_SEA = (10.0, 72.0)
SEA_POINTS = {
    "Andaman and Nicobar Islands": ANDAMAN_SEA,
    "Andhra Pradesh": BAY_OF_BENGAL,
    "Dadra and Nagar Haveli and Daman and Diu": ARABIAN_SEA,
    "Goa": ARABIAN_SEA,
    "Gujarat": ARABIAN_SEA,
    "Karnataka": ARABIAN_SEA,
    "Kerala": LACCADIVE_SEA,
    "Lakshadweep": LACCADIVE_SEA,
    "Maharashtra": ARABIAN_SEA,
    "Odisha": BAY_OF_BENGAL,
    "Puducherry": BAY_OF_BENGAL,
    "Tamil Nadu": BAY_OF_BENGAL,
    "West Bengal": BAY_OF_BENGAL,
}

HAZARDS = ("flood", "cyclone", "earthquake")

SOURCES = {
    "flood": "India Flood Inventory (flood events recorded in the state)",
    "cyclone": "NOAA IBTrACS (storms passing within 100 km)",
    "earthquake": "USGS (M6.0+ within 300 km)",
}


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _storm_month(sid: str) -> int | None:
    """IBTrACS storm ids start with the genesis year and day of year: 1999286N17087 -> October."""
    try:
        year, day = int(sid[:4]), int(sid[4:7])
        return (date(year, 1, 1) + timedelta(days=day - 1)).month
    except (ValueError, TypeError):
        return None


@dataclass(frozen=True)
class Tables:
    regions: pd.DataFrame  # one row per state: lat, lon, rates, max magnitude
    floods: pd.DataFrame  # region, year, month (one row per state per flood event)
    storms: pd.DataFrame  # region, year, month
    quakes: pd.DataFrame  # region, year, month, magnitude
    low_lying: dict[str, float]  # mean share of district land below 10 m, 0-100
    flood_years: tuple[int, int]
    storm_years: tuple[int, int]
    quake_years: tuple[int, int]


@lru_cache(maxsize=1)
def load_tables() -> Tables:
    regions = pd.read_csv(CLEAN / "hazard" / "regions.csv").set_index("region")
    names = set(regions.index)

    ifi = pd.read_csv(CLEAN / "flood" / "ifi_event_dates.csv", usecols=["uei", "start", "state"])
    ifi["start"] = pd.to_datetime(ifi["start"], errors="coerce")
    ifi = ifi.dropna(subset=["start", "state"])
    ifi["region"] = ifi["state"].str.split(",")
    ifi = ifi.explode("region")
    ifi["region"] = ifi["region"].str.strip().replace(IFI_ALIASES)
    ifi = ifi[ifi["region"].isin(names)].drop_duplicates(["uei", "region"])
    floods = pd.DataFrame({"region": ifi["region"], "year": ifi["start"].dt.year, "month": ifi["start"].dt.month})

    cy = pd.read_csv(CLEAN / "hazard" / "cyclone_storms.csv")
    cy["month"] = cy["sid"].map(_storm_month)
    cy = cy.dropna(subset=["month"])
    storms = pd.DataFrame({"region": cy["region"], "year": cy["season"].astype(int), "month": cy["month"].astype(int)})

    eq = pd.read_csv(CLEAN / "hazard" / "eq_events.csv")
    eq["time"] = pd.to_datetime(eq["time"], errors="coerce")
    eq = eq.dropna(subset=["time"])
    quakes = pd.DataFrame({"region": eq["region"], "year": eq["time"].dt.year,
                           "month": eq["time"].dt.month, "magnitude": eq["magnitude"]})

    districts = pd.read_csv(CLEAN / "flood" / "districts.csv", usecols=["state", "low_lying_pct"])
    districts["state"] = districts["state"].str.split().str.join(" ")
    low_lying = districts.groupby("state")["low_lying_pct"].mean().dropna().to_dict()

    span = lambda frame: (int(frame["year"].min()), int(frame["year"].max()))  # noqa: E731
    return Tables(regions, floods, storms, quakes, low_lying, span(floods), span(storms), span(quakes))


def region_list() -> list[dict[str, Any]]:
    """The 36 states and union territories with a centroid and, if coastal, a sea point."""
    t = load_tables()
    return [
        {
            "region": name,
            "lat": round(float(row["lat"]), 3),
            "lon": round(float(row["lon"]), 3),
            "coastal": name in SEA_POINTS,
            "sea_point": list(SEA_POINTS[name]) if name in SEA_POINTS else None,
        }
        for name, row in t.regions.iterrows()
    ]


def _window_months(start: date, days: int) -> list[int]:
    """Calendar months touched by the forecast window, in order."""
    months: list[int] = []
    for offset in range(days):
        month = (start + timedelta(days=offset)).month
        if month not in months:
            months.append(month)
    return months


def _monthly_share(frame: pd.DataFrame, region: str) -> list[float]:
    counts = frame.loc[frame["region"] == region, "month"].value_counts()
    total = counts.sum()
    return [round(float(counts.get(m, 0) / total), 4) if total else 0.0 for m in range(1, 13)]


def _history(frame: pd.DataFrame, region: str, months: list[int], years: tuple[int, int]) -> dict[str, Any]:
    """Events in the window's months, per year, over the last ten years the source covers."""
    last = years[1]
    first = last - HISTORY_YEARS + 1
    rows = frame[(frame["region"] == region) & frame["month"].isin(months) & frame["year"].between(first, last)]
    per_year = rows["year"].value_counts()
    series = [{"year": y, "count": int(per_year.get(y, 0))} for y in range(first, last + 1)]
    earlier = sum(item["count"] for item in series[:5])
    later = sum(item["count"] for item in series[5:])
    trend = "up" if later > earlier else "down" if later < earlier else "flat"
    return {"total": int(len(rows)), "years": [first, last], "per_year": series,
            "earlier_5": earlier, "later_5": later, "trend": trend}


def baseline(region: str, start: date, days: int) -> dict[str, Any]:
    """Historical factors (0-1) per hazard for one state, and its same-season history."""
    t = load_tables()
    if region not in t.regions.index:
        raise ValueError(f"Unknown region '{region}'. Use one of the 36 Indian states and union territories.")
    if days not in (7, 30, 90):
        raise ValueError("days must be 7, 30 or 90.")
    row = t.regions.loc[region]
    months = _window_months(start, days)

    # Historical frequency, relative to the most-exposed state.
    flood_years_hit = t.floods.groupby("region")["year"].nunique()
    flood_span = t.flood_years[1] - t.flood_years[0] + 1
    flood_freq = flood_years_hit / flood_span
    frequency = {
        "flood": _clamp(float(flood_freq.get(region, 0.0)) / float(flood_freq.max())),
        "cyclone": _clamp(float(row["cy_rate_ts_per_year"]) / float(t.regions["cy_rate_ts_per_year"].max())),
        "earthquake": _clamp(float(row["eq_rate_per_year"]) / float(t.regions["eq_rate_per_year"].max())),
    }

    # Geographic vulnerability.
    max_mag = row["eq_max_magnitude"]
    geography = {
        # Mean share of district land below 10 m elevation; 50% or more counts as fully exposed.
        "flood": _clamp(t.low_lying.get(region, 0.0) / 50.0),
        # Cyclones weaken quickly over land: a coast is the main exposure.
        "cyclone": 1.0 if region in SEA_POINTS else 0.3,
        # Largest historical magnitude nearby, from M6 (0) to M8.5 (1).
        "earthquake": _clamp((float(max_mag) - 6.0) / 2.5) if pd.notna(max_mag) else 0.0,
    }

    return {
        "region": region,
        "lat": round(float(row["lat"]), 3),
        "lon": round(float(row["lon"]), 3),
        "coastal": region in SEA_POINTS,
        "sea_point": list(SEA_POINTS[region]) if region in SEA_POINTS else None,
        "population": int(row["population"]) if pd.notna(row["population"]) else None,
        "start": start.isoformat(),
        "days": days,
        "months": months,
        "hazards": {
            "flood": {"frequency": round(frequency["flood"], 4), "geography": round(geography["flood"], 4),
                      "monthly_share": _monthly_share(t.floods, region), "seasonal": True,
                      "history": _history(t.floods, region, months, t.flood_years), "source": SOURCES["flood"]},
            "cyclone": {"frequency": round(frequency["cyclone"], 4), "geography": round(geography["cyclone"], 4),
                        "monthly_share": _monthly_share(t.storms, region), "seasonal": True,
                        "history": _history(t.storms, region, months, t.storm_years), "source": SOURCES["cyclone"]},
            # Earthquakes have no season: the seasonal factor is a flat 0.5, not a monthly share.
            "earthquake": {"frequency": round(frequency["earthquake"], 4), "geography": round(geography["earthquake"], 4),
                           "monthly_share": None, "seasonal": False,
                           "history": _history(t.quakes, region, months, t.quake_years), "source": SOURCES["earthquake"]},
        },
    }


# ── Gemini narrative ─────────────────────────────────────────────────────

PROMPT = (
    "You are a disaster risk analyst. Region: {region}, Season: {season}, Forecast: {days} days, "
    "Weather: Precipitation={precip}mm Wind={wind}km/h Soil Moisture={soil}, Seismic: {seismic}. "
    "Respond ONLY in this JSON: {{ overall_risk, most_likely_disaster, risk_factors: [], "
    "estimated_affected_population, confidence, narrative, immediate_actions: [] }}"
)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
NARRATIVE_TTL_SECONDS = 1800

_cache: dict[tuple, tuple[float, dict[str, Any]]] = {}
_cache_lock = threading.Lock()


class NarrativeUnavailable(RuntimeError):
    """Gemini is not configured, or did not return a usable answer."""

    def __init__(self, message: str, status: int = 503) -> None:
        super().__init__(message)
        self.status = status


def _fmt(value: float | None, digits: int = 1) -> str:
    return "unknown" if value is None or (isinstance(value, float) and math.isnan(value)) else f"{value:.{digits}f}"


def build_prompt(region: str, season: str, days: int, precip: float | None, wind: float | None,
                 soil: float | None, seismic: str) -> str:
    return PROMPT.format(region=region, season=season, days=days, precip=_fmt(precip), wind=_fmt(wind),
                         soil=_fmt(soil, 3), seismic=seismic or "none recorded")


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()][:8]
    return [str(value)] if value else []


def _parse(text: str) -> dict[str, Any]:
    import json

    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").removeprefix("json").strip()
    data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise ValueError("not an object")
    return {
        "overall_risk": str(data.get("overall_risk", "")),
        "most_likely_disaster": str(data.get("most_likely_disaster", "")),
        "risk_factors": _as_list(data.get("risk_factors")),
        "estimated_affected_population": str(data.get("estimated_affected_population", "")),
        "confidence": str(data.get("confidence", "")),
        "narrative": str(data.get("narrative", "")),
        "immediate_actions": _as_list(data.get("immediate_actions")),
    }


def narrative(region: str, season: str, days: int, precip: float | None, wind: float | None,
              soil: float | None, seismic: str, client: httpx.Client | None = None) -> dict[str, Any]:
    """Ask Gemini for the analyst narrative. Answers are cached for 30 minutes per input."""
    settings = get_settings()
    if not settings.gemini_api_key:
        raise NarrativeUnavailable("The AI narrative is not configured: set GEMINI_API_KEY in backend/.env.")
    if region not in load_tables().regions.index:
        raise ValueError(f"Unknown region '{region}'.")
    prompt = build_prompt(region, season, days, precip, wind, soil, seismic)
    key = (settings.gemini_model, prompt)
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < NARRATIVE_TTL_SECONDS:
            return hit[1]

    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.4}}
    owns_client = client is None
    # Gemini 2.5 models think before answering; 20-40 s is normal.
    client = client or httpx.Client(timeout=60)
    try:
        response = client.post(GEMINI_URL.format(model=settings.gemini_model), json=body,
                               headers={"x-goog-api-key": settings.gemini_api_key})
    except httpx.HTTPError as error:
        logger.warning("Gemini request failed: %s", error)
        raise NarrativeUnavailable("The AI service could not be reached. Try again later.", 502) from error
    finally:
        if owns_client:
            client.close()
    if response.status_code != 200:
        logger.warning("Gemini answered HTTP %s: %s", response.status_code, response.text[:300])
        raise NarrativeUnavailable(f"The AI service answered with an error (HTTP {response.status_code}).", 502)
    try:
        text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
        result = _parse(text)
    except (KeyError, IndexError, TypeError, ValueError) as error:
        logger.warning("Gemini answer was not the expected JSON: %s", error)
        raise NarrativeUnavailable("The AI answer could not be read. Try again.", 502) from error

    result = {**result, "model": settings.gemini_model, "prompt": prompt}
    with _cache_lock:
        _cache[key] = (time.time(), result)
    return result
