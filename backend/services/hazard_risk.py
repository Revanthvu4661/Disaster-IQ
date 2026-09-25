"""Level 2 for earthquakes and cyclones: a statistical hazard index per state.

This is **not a trained model.** For each state or union territory it counts
what the historical catalogues record nearby, turns the counts into annual
probabilities under a Poisson assumption (events arrive independently at their
historical average rate), and maps those probabilities to the same four risk
levels the flood model uses. Each level has a fixed, published cut-off, so the
result can be checked by hand.

    annual probability = 1 − exp(−events ÷ years of record)

Earthquake (USGS ComCat, 1950-2025, 76 years, events within 300 km of the state):
    test A  at least one M6.0+   critical ≥ 40%   high ≥ 15%   medium ≥ 5%
    test B  at least one M7.0+   critical ≥ 10%   high ≥  4%   medium ≥ 1%

Cyclone (NOAA IBTrACS, North Indian Ocean, 1980-2025, 46 seasons, track centre
within 100 km of the state):
    test A  hurricane strength (64 kt+)       critical ≥ 15%   high ≥ 6%   medium ≥ 2%
    test B  tropical-storm strength (34 kt+)  critical ≥ 60%   high ≥ 30%  medium ≥ 10%

A region's level is the highest level reached by either test, and the
probability shown is the one from the test that decided it. The cut-offs are
return-period judgements (for example "about once in 7 years" for critical
hurricane-strength cyclones), not calibrated to losses.

Population comes from Census 2011, summed to today's states.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from backend.config import DATA_DIR
from backend.services.flood_risk import RISK_LEVELS

HAZARD_DIR = DATA_DIR / "clean" / "hazard"
LEVEL_ORDER = ["low", "medium", "high", "critical"]

TESTS: dict[str, list[dict[str, Any]]] = {
    "earthquake": [
        {"key": "m6", "label": "M6.0+ earthquake within 300 km", "count": "eq_events_m6",
         "thresholds": {"critical": 0.40, "high": 0.15, "medium": 0.05}},
        {"key": "m7", "label": "M7.0+ earthquake within 300 km", "count": "eq_events_m7",
         "thresholds": {"critical": 0.10, "high": 0.04, "medium": 0.01}},
    ],
    "cyclone": [
        {"key": "hurricane", "label": "Hurricane-strength (64 kt+) cyclone within 100 km",
         "count": "cy_storms_hurricane",
         "thresholds": {"critical": 0.15, "high": 0.06, "medium": 0.02}},
        {"key": "tropical_storm", "label": "Tropical-storm-strength (34 kt+) cyclone within 100 km",
         "count": "cy_storms_ts",
         "thresholds": {"critical": 0.60, "high": 0.30, "medium": 0.10}},
    ],
}

#: Known events checked against the catalogue-derived counts: (type, region, year, name, minimum size, note).
KNOWN_EVENTS = [
    ("earthquake", "Gujarat", 2001, "Bhuj earthquake", 7.5, "M7.7; about 20,000 deaths."),
    ("earthquake", "Assam", 1950, "Assam–Tibet earthquake", 8.5, "M8.6, one of the largest recorded on land."),
    ("earthquake", "Bihar", 2015, "Nepal (Gorkha) earthquake", 7.5, "M7.8; shaking reached Bihar and Uttar Pradesh."),
    ("earthquake", "Jammu and Kashmir", 2005, "Kashmir earthquake", 7.5, "M7.6 near Muzaffarabad; felt across Kashmir."),
    ("cyclone", "Odisha", 1999, "Odisha super cyclone", 64, "Landfall near Paradip, October 1999."),
    ("cyclone", "Odisha", 2019, "Cyclone Fani", 64, "Landfall near Puri, May 2019."),
    ("cyclone", "West Bengal", 2020, "Cyclone Amphan", 64, "Landfall at the Sundarbans, May 2020."),
    ("cyclone", "Andhra Pradesh", 2014, "Cyclone Hudhud", 64, "Landfall at Visakhapatnam, October 2014."),
    ("cyclone", "Gujarat", 2021, "Cyclone Tauktae", 64, "Landfall near Diu and Una, May 2021."),
]

EQ_METHOD = [
    "Take every earthquake of magnitude 6.0 or more in the USGS ComCat catalogue from 1950 to 2025 (76 years).",
    "Keep those whose epicentre lies inside the state or within 300 km of its boundary.",
    "Divide the count by 76 to get the average events a year; convert to an annual probability, 1 − exp(−rate).",
    "Do the same for magnitude 7.0 and above, which has its own cut-offs so that a rare large earthquake (Gujarat 2001) still counts.",
    "The level is the higher of the two tests.",
]
CY_METHOD = [
    "Take every storm in NOAA IBTrACS for the North Indian Ocean from the 1980 to 2025 seasons (46 seasons).",
    "Keep those whose track centre came within 100 km of the state's boundary while at tropical-storm strength (34 kt or more, 1-minute wind).",
    "Count the ones that reached hurricane strength (64 kt or more) while that close.",
    "Divide by 46 to get the average storms a season; convert to an annual probability, 1 − exp(−rate).",
    "The level is the higher of the hurricane test and the tropical-storm test.",
]

NOT_INCLUDED = {
    "earthquake": [
        {"metric": "Ground conditions and building quality",
         "reason": "The index counts nearby earthquakes; it does not know soil amplification, liquefaction or how well "
                   "buildings are built."},
        {"metric": "Fault-level hazard and the official seismic zone map",
         "reason": "Not used. This is a catalogue count, not a probabilistic seismic hazard assessment."},
        {"metric": "Earthquakes before 1950 and below M6",
         "reason": "The catalogue is incomplete for early decades and small events; a longer record would change the rates."},
        {"metric": "Time-varying risk",
         "reason": "Earthquakes are treated as independent events. Aftershock clusters count as several events, and "
                   "nothing says when the next one will happen."},
    ],
    "cyclone": [
        {"metric": "Storm surge, coastal terrain and rainfall",
         "reason": "The index uses track position and wind at the storm centre, not the wind, surge or flooding a "
                   "state actually felt."},
        {"metric": "Storms in the coming season",
         "reason": "It is a long-run frequency (1980–2025); it is not a seasonal or live forecast."},
        {"metric": "Wind at the state itself",
         "reason": "Wind is measured at the storm centre when it was within 100 km, so inland states are overstated "
                   "relative to their coast."},
        {"metric": "Climate trends",
         "reason": "Rates are averaged over 46 seasons; any trend in frequency or intensity is not modelled."},
    ],
}


def level_of(probability: float, thresholds: dict[str, float]) -> str:
    for level in ("critical", "high", "medium"):
        if probability >= thresholds[level]:
            return level
    return "low"


def annual_probability(events: int, years: int) -> float:
    return 1 - math.exp(-events / years)


@dataclass
class HazardRisk:
    regions: pd.DataFrame
    eq_events: pd.DataFrame
    storms: pd.DataFrame
    meta: dict
    payloads: dict[str, dict] = field(init=False)

    def __post_init__(self) -> None:
        self.payloads = {t: self._payload(t) for t in TESTS}

    # ── indices ──────────────────────────────────────────────────────────

    def _years(self, kind: str) -> int:
        m = self.meta[kind]
        return (m["last_year"] - m["first_year"] + 1) if kind == "earthquake" else (
            m["last_season"] - m["first_season"] + 1)

    def _region_rows(self, kind: str) -> list[dict[str, Any]]:
        years = self._years(kind)
        rows = []
        for r in self.regions.itertuples():
            tests, best = [], None
            for spec in TESTS[kind]:
                count = int(getattr(r, spec["count"]))
                p = annual_probability(count, years)
                level = level_of(p, spec["thresholds"])
                item = {"key": spec["key"], "label": spec["label"], "events": count,
                        "probability": round(p, 4), "level": level}
                tests.append(item)
                if best is None or (LEVEL_ORDER.index(level), p) > (LEVEL_ORDER.index(best["level"]), best["probability"]):
                    best = item
            row = {
                "region": r.region,
                "lat": float(r.lat),
                "lon": float(r.lon),
                "population": int(r.population),
                "area_km2": int(r.area_km2),
                "level": best["level"],
                "probability": best["probability"],
                "driver": best["label"],
                "tests": tests,
                "years": years,
            }
            if kind == "earthquake":
                events = self.eq_events[self.eq_events["region"] == r.region]
                row.update({
                    "events_m6": int(r.eq_events_m6),
                    "events_m7": int(r.eq_events_m7),
                    "max_magnitude": None if pd.isna(r.eq_max_magnitude) else float(r.eq_max_magnitude),
                    "max_year": None if pd.isna(r.eq_max_year) else int(r.eq_max_year),
                    "max_place": None if pd.isna(r.eq_max_place) else r.eq_max_place,
                    "top_events": [
                        {"time": e.time, "magnitude": float(e.magnitude), "place": e.place, "dist_km": float(e.dist_km)}
                        for e in events.head(5).itertuples()
                    ],
                })
            else:
                storms = self.storms[self.storms["region"] == r.region].sort_values(
                    ["max_wind_kt", "season"], ascending=[False, True])
                row.update({
                    "storms_ts": int(r.cy_storms_ts),
                    "storms_hurricane": int(r.cy_storms_hurricane),
                    "max_wind_kt": None if pd.isna(r.cy_max_wind_kt) else float(r.cy_max_wind_kt),
                    "max_name": None if pd.isna(r.cy_max_name) else str(r.cy_max_name).title(),
                    "max_season": None if pd.isna(r.cy_max_season) else int(r.cy_max_season),
                    "top_events": [
                        {"name": str(s.name).title(), "season": int(s.season), "max_wind_kt": float(s.max_wind_kt),
                         "min_dist_km": float(s.min_dist_km)}
                        for s in storms.head(5).itertuples()
                    ],
                })
            row["summary"] = _summary(kind, row)
            rows.append(row)
        rows.sort(key=lambda x: (-LEVEL_ORDER.index(x["level"]), -x["probability"], x["region"]))
        return rows

    def _checks(self, kind: str) -> list[dict[str, Any]]:
        out = []
        for type_, region, year, name, minimum, note in KNOWN_EVENTS:
            if type_ != kind:
                continue
            if kind == "earthquake":
                pool = self.eq_events[(self.eq_events["region"] == region) & (self.eq_events["year"] == year)
                                      & (self.eq_events["magnitude"] >= minimum)]
                found = not pool.empty
                detail = (f"M{pool['magnitude'].max():.1f} in the catalogue, {pool.iloc[0]['dist_km']:.0f} km from the "
                          f"boundary" if found else "not found within 300 km")
            else:
                pool = self.storms[(self.storms["region"] == region) & (self.storms["season"] == year)
                                   & (self.storms["max_wind_kt"] >= minimum)]
                found = not pool.empty
                detail = (f"{pool['max_wind_kt'].max():.0f} kt while its centre was within {pool['min_dist_km'].min():.0f} km"
                          if found else "not found within 100 km at that strength")
            out.append({"name": name, "year": year, "region": region, "found": bool(found), "detail": detail,
                        "note": note})
        return out

    def _payload(self, kind: str) -> dict[str, Any]:
        rows = self._region_rows(kind)
        counts = {band["level"]: 0 for band in RISK_LEVELS}
        for row in rows:
            counts[row["level"]] += 1
        m = self.meta[kind]
        years = self._years(kind)
        if kind == "earthquake":
            source = ["usgs"]
            period = [m["first_year"], m["last_year"]]
            record = (f"{m['events_in_catalogue']:,} M6+ earthquakes worldwide in the catalogue, "
                      f"{m['first_year']}–{m['last_year']}")
            steps = EQ_METHOD
        else:
            source = ["ibtracs"]
            period = [m["first_season"], m["last_season"]]
            record = f"IBTrACS North Indian Ocean tracks, {m['first_season']}–{m['last_season']} seasons"
            steps = CY_METHOD
        return {
            "type": kind,
            "region_kind": "state or union territory",
            "regions": rows,
            "counts": counts,
            "methodology": {
                "name": "Statistical hazard index",
                "is_trained_model": False,
                "statement": ("This is a statistical hazard index computed from historical catalogues, not a trained "
                              "machine-learning model. It says how often damaging events have happened near a state, "
                              "not when the next one will."),
                "steps": steps,
                "period": period,
                "years": years,
                "radius_km": m["radius_km"],
                "tests": [{"key": t["key"], "label": t["label"], "thresholds": t["thresholds"]} for t in TESTS[kind]],
                "record": record,
            },
            "checks": self._checks(kind),
            "not_included": NOT_INCLUDED[kind],
            "source": source,
            "population_source": "Census of India 2011, summed to today's states and union territories",
            "built_at": self.meta["built_at"],
        }

    # ── uniform rows for the recommendation engine ───────────────────────

    def predictions(self, kind: str) -> dict[str, Any]:
        if kind not in TESTS:
            raise ValueError(f"Unknown hazard '{kind}'. Use one of: {', '.join(TESTS)}")
        payload = self.payloads[kind]
        return {"scenario": "long-term", "kind": "index", "type": kind, "districts": payload["regions"],
                "window_start": str(payload["methodology"]["period"][0]),
                "as_of": str(payload["methodology"]["period"][1])}


def _summary(kind: str, row: dict[str, Any]) -> str:
    if kind == "earthquake":
        if row["events_m6"] == 0:
            return "No M6+ earthquake within 300 km since 1950."
        text = f"{row['events_m6']} M6+ earthquakes within 300 km since 1950"
        if row["events_m7"]:
            text += f", {row['events_m7']} of them M7+"
        return text + f"; strongest M{row['max_magnitude']:.1f} in {row['max_year']}."
    if row["storms_ts"] == 0:
        return "No tropical storm passed within 100 km since 1980."
    text = f"{row['storms_ts']} tropical storms within 100 km since 1980"
    if row["storms_hurricane"]:
        text += f", {row['storms_hurricane']} at hurricane strength"
    return text + f"; strongest {row['max_name']} ({row['max_season']}) at {row['max_wind_kt']:.0f} kt."


def load_hazard_risk(hazard_dir: Path = HAZARD_DIR) -> HazardRisk:
    return HazardRisk(
        regions=pd.read_csv(hazard_dir / "regions.csv"),
        eq_events=pd.read_csv(hazard_dir / "eq_events.csv"),
        storms=pd.read_csv(hazard_dir / "cyclone_storms.csv"),
        meta=json.loads((hazard_dir / "meta.json").read_text(encoding="utf-8")),
    )
