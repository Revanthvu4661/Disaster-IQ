"""Level 3: preparedness and response recommendations for earthquakes, floods and cyclones.

A transparent, rule-based engine (not a model) that consumes the Level 2 risk
output for any of the three hazards and returns two things per region:

**Preparedness** (before a disaster): a list of actions from a fixed rule table.
A rule fires when the region's risk level reaches the rule's minimum level (and
its trigger, if it has one, holds). Every action carries the reason it fired.

**Response** (during and after): a resource estimate from a documented formula.

    people    = population × EXPOSURE[hazard][level]
    medical   = ceil(people × CONSULT_RATE ÷ EMT_PATIENTS_PER_DAY)
    food      = people × days                         (one ration per person per day)
    water_l   = people × WATER_L_PER_DAY × days
    shelter   = people                                 (temporary places)
    floor_m2  = shelter × SHELTER_M2_PER_PERSON
    long_stay = people × homeless share                (EM-DAT, flood only)

and one hazard-specific line:

    flood       rescue boats   = ceil(people × low-lying share ÷ BOAT_PEOPLE_PER_BOAT)
    earthquake  rescue teams   = ceil(people ÷ SAR_PEOPLE_PER_TEAM)
    cyclone     cyclone shelters = ceil(people ÷ CYCLONE_SHELTER_CAPACITY)

Priority order: risk level, then people needing assistance, then the
level's own probability. Where a number comes from is labelled in
``PARAMETERS``: a published standard (Sphere, WHO), public data (Census 2011,
the DEM, EM-DAT) or an assumption to be replaced with a State Disaster
Management Authority's own planning figure.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

LEVELS = ["low", "medium", "high", "critical"]
TIER = {"critical": 1, "high": 2, "medium": 3, "low": 4}
RESPONSE_TIER_LABEL = {1: "Priority 1: resource first", 2: "Priority 2: pre-position", 3: "Priority 3: standby",
                       4: "Monitor"}
PREPAREDNESS_TIER_LABEL = {1: "Priority 1: act this year", 2: "Priority 2: plan and pre-position",
                           3: "Priority 3: build readiness", 4: "Routine monitoring"}

TYPES = ("earthquake", "flood", "cyclone")

#: Share of a region's population needing emergency assistance in a damaging event (assumption).
#: Earthquake and cyclone regions are whole states, and one event affects only part of a state,
#: so their shares are smaller than the flood shares, which are for districts.
EXPOSURE: dict[str, dict[str, float]] = {
    "flood": {"critical": 0.05, "high": 0.02, "medium": 0.005, "low": 0.0},
    "earthquake": {"critical": 0.02, "high": 0.005, "medium": 0.001, "low": 0.0},
    "cyclone": {"critical": 0.03, "high": 0.01, "medium": 0.0025, "low": 0.0},
}

BOAT_PEOPLE_PER_BOAT = 200      # 10 people a trip x 10 trips a day x 2 days
SAR_PEOPLE_PER_TEAM = 5000      # one search-and-rescue team per 5,000 people needing assistance
CYCLONE_SHELTER_CAPACITY = 1000  # people one cyclone shelter holds
CONSULT_RATE = 0.02             # share of people needing a medical consultation each day
EMT_PATIENTS_PER_DAY = 50       # WHO Emergency Medical Team Type 1 (mobile): at least 50 outpatients a day
WATER_L_PER_DAY = 15            # Sphere minimum: 15 litres per person per day
SHELTER_M2_PER_PERSON = 3.5     # Sphere minimum covered living space per person
DEFAULT_DAYS = 7
MAX_DAYS = 30

GENERAL_BASIS = "General practice; confirm against NDMA and State Disaster Management Authority guidance."

PARAMETERS = [
    {"key": "exposure", "label": "People needing assistance",
     "value": "flood: 5% / 2% / 0.5% / 0% · earthquake: 2% / 0.5% / 0.1% / 0% · cyclone: 3% / 1% / 0.25% / 0% "
              "of population (critical / high / medium / low)",
     "basis": "assumption",
     "note": "Planning scale for a damaging event. Earthquake and cyclone regions are whole states, so their shares "
             "are smaller than the flood shares, which are for districts."},
    {"key": "boats", "label": "Rescue boats (flood)", "value": f"{BOAT_PEOPLE_PER_BOAT} people per boat",
     "basis": "assumption",
     "note": "10 people a trip, 10 trips a day, over 2 days; applied only to the share of people on land below 10 m."},
    {"key": "sar", "label": "Search-and-rescue teams (earthquake)", "value": f"1 team per {SAR_PEOPLE_PER_TEAM:,} people",
     "basis": "assumption", "note": "For people trapped in collapsed buildings; replace with an SDMA/NDRF deployment norm."},
    {"key": "cyclone_shelters", "label": "Cyclone shelters (cyclone)", "value": f"{CYCLONE_SHELTER_CAPACITY:,} people each",
     "basis": "assumption", "note": "A wind-resistant multipurpose shelter; replace with real shelter capacities."},
    {"key": "medical", "label": "Medical teams",
     "value": f"{EMT_PATIENTS_PER_DAY} patients a day; {CONSULT_RATE:.0%} of people need a consultation daily",
     "basis": "standard + assumption",
     "note": "WHO Emergency Medical Team Type 1 (mobile) minimum capacity; the consultation rate is an assumption."},
    {"key": "food", "label": "Food", "value": "1 ration per person per day",
     "basis": "standard", "note": "A ration meets Sphere's 2,100 kcal per person per day."},
    {"key": "water", "label": "Drinking and domestic water", "value": f"{WATER_L_PER_DAY} L per person per day",
     "basis": "standard", "note": "Sphere Handbook (2018) minimum water quantity."},
    {"key": "shelter", "label": "Shelter space", "value": f"{SHELTER_M2_PER_PERSON} m² per person",
     "basis": "standard", "note": "Sphere minimum covered living space. Every person needing assistance is given a "
                                  "temporary place."},
    {"key": "long_stay", "label": "Long-stay shelter (flood)", "value": "EM-DAT homeless share",
     "basis": "data", "note": "Share of people affected by floods in India that EM-DAT records as homeless (Level 1 data)."},
]

#: Preparedness rules. A rule fires when the level is at least ``min_level`` and ``when`` (if any) is true.
def _rules() -> dict[str, list[dict[str, Any]]]:
    def rule(id_, category, action, min_level, why, when=None):
        return {"id": id_, "category": category, "action": action, "min_level": min_level, "why": why, "when": when,
                "basis": GENERAL_BASIS}

    return {
        "earthquake": [
            rule("eq-audit", "Structural", "Audit and retrofit schools, hospitals and lifeline buildings.", "high",
                 lambda r: f"{r['events_m6']} M6+ earthquakes within 300 km since 1950."),
            rule("eq-code", "Structural", "Enforce seismic design (IS 1893) and inspection for new construction.",
                 "medium", lambda r: f"Level {r['level']}: annual chance of an M6+ earthquake nearby is "
                                     f"{r['tests'][0]['probability']:.0%}."),
            rule("eq-large", "Planning", "Plan for a large earthquake (M7+): assembly points, routes and hospital surge.",
                 "medium", lambda r: f"{r['events_m7']} M7+ earthquakes within 300 km since 1950.",
                 when=lambda r: r["events_m7"] >= 1),
            rule("eq-drills", "Planning", "Run earthquake drills (drop, cover, hold) in schools and offices.", "medium",
                 lambda r: f"Level {r['level']} for earthquakes."),
            rule("eq-sar", "Pre-positioning", "Pre-position urban search-and-rescue teams and heavy lifting equipment.",
                 "high", lambda r: f"Level {r['level']}; {r['population'] / 1e5:,.0f} lakh people."),
            rule("eq-trauma", "Health", "Prepare trauma-care and blood-bank surge plans; confirm key hospitals are "
                                        "structurally sound.", "high", lambda r: f"Level {r['level']} for earthquakes."),
            rule("eq-warning", "Early warning & communication",
                 "Publicise safe assembly points and aftershock advice; test backup communications.", "medium",
                 lambda r: f"Level {r['level']} for earthquakes."),
        ],
        "flood": [
            rule("fl-drains", "Structural", "Clear and desilt drains; inspect embankments and sluices before the monsoon.",
                 "medium", lambda r: f"Level {r['level']}: {r['summary'] or 'flood risk this window'}"),
            rule("fl-routes", "Planning", "Map and publish evacuation routes and relief-camp locations for low-lying areas.",
                 "high", lambda r: f"{r['low_lying_pct']:.0f}% of the district is below 10 m.",
                 when=lambda r: r["low_lying_pct"] >= 5 or r["level"] == "critical"),
            rule("fl-warning", "Early warning & communication",
                 "Act on IMD and CWC alerts; agree rainfall triggers for evacuating low-lying wards.", "medium",
                 lambda r: f"Level {r['level']} for floods."),
            rule("fl-boats", "Pre-positioning", "Pre-position rescue boats and trained crews.", "high",
                 lambda r: f"{r['low_lying_pct']:.0f}% of the district is below 10 m.",
                 when=lambda r: r["low_lying_pct"] >= 5),
            rule("fl-camps", "Pre-positioning", "Stock relief camps with drinking water, sanitation and food.", "medium",
                 lambda r: f"Level {r['level']}; {r['population'] / 1e5:,.1f} lakh people."),
            rule("fl-health", "Health", "Stock ORS, chlorine tablets and other waterborne-disease supplies.", "high",
                 lambda r: f"Level {r['level']} for floods."),
        ],
        "cyclone": [
            rule("cy-warning", "Early warning & communication",
                 "Check that IMD cyclone warnings reach coastal villages (sirens, SMS, volunteers).", "medium",
                 lambda r: f"{r['storms_ts']} tropical storms within 100 km since 1980."),
            rule("cy-fishing", "Planning", "Keep a standing procedure to recall fishing boats and secure harbours.",
                 "medium", lambda r: f"Level {r['level']} for cyclones."),
            rule("cy-routes", "Planning", "Mark and maintain coastal evacuation routes; agree evacuation triggers.",
                 "high", lambda r: f"{r['storms_hurricane']} hurricane-strength storms within 100 km since 1980."),
            rule("cy-shelters", "Structural",
                 "Ensure wind-resistant cyclone shelters with capacity for the at-risk coastal population.", "high",
                 lambda r: f"Level {r['level']}; {r['population'] / 1e5:,.0f} lakh people in the state."),
            rule("cy-power", "Pre-positioning", "Arrange backup power and communications at hospitals and control rooms.",
                 "high", lambda r: f"Level {r['level']} for cyclones."),
            rule("cy-stock", "Pre-positioning",
                 "Stock food, drinking water and medicines before the season; plan road clearance after landfall.",
                 "critical", lambda r: f"Annual chance of a hurricane-strength storm nearby is "
                                       f"{r['tests'][0]['probability']:.0%}."),
        ],
    }


RULES = _rules()


def homeless_share(impact_records: pd.DataFrame, iso3: str = "IND") -> dict[str, Any]:
    """Σ homeless ÷ Σ total affected over the country's EM-DAT flood records reporting both."""
    floods = impact_records[(impact_records["iso3"] == iso3) & (impact_records["type"] == "flood")]
    both = floods[(floods["homeless"] > 0) & (floods["total_affected"] > 0)]
    share = float(both["homeless"].sum() / both["total_affected"].sum()) if len(both) else 0.0
    return {
        "value": round(share, 4),
        "records": int(len(both)),
        "years": [int(both["year"].min()), int(both["year"].max())] if len(both) else None,
        "homeless": int(both["homeless"].sum()),
        "total_affected": int(both["total_affected"].sum()),
        "source": "EM-DAT via Our World in Data (Level 1 store)",
    }


def _name(row: dict) -> str:
    return row.get("district") or row["region"]


def preparedness(kind: str, row: dict) -> list[dict[str, Any]]:
    """The actions whose rules fire for one region, most urgent categories first."""
    level_index = LEVELS.index(row["level"])
    actions = []
    for rule in RULES[kind]:
        if level_index < LEVELS.index(rule["min_level"]):
            continue
        if rule["when"] and not rule["when"](row):
            continue
        actions.append({"id": rule["id"], "category": rule["category"], "action": rule["action"],
                        "why": rule["why"](row), "basis": rule["basis"]})
    return actions


def _resources(kind: str, row: dict, people: int, days: int, homeless: float) -> dict[str, int]:
    res = {
        "people": people,
        "medical_teams": math.ceil(people * CONSULT_RATE / EMT_PATIENTS_PER_DAY),
        "food_rations": people * days,
        "water_litres": people * WATER_L_PER_DAY * days,
        "shelter_places": people,
        "shelter_m2": round(people * SHELTER_M2_PER_PERSON),
    }
    if kind == "flood":
        res["rescue_boats"] = math.ceil(people * row["low_lying_pct"] / 100 / BOAT_PEOPLE_PER_BOAT)
        res["long_stay_places"] = round(people * homeless)
    elif kind == "earthquake":
        res["rescue_teams"] = math.ceil(people / SAR_PEOPLE_PER_TEAM)
    else:
        res["cyclone_shelters"] = math.ceil(people / CYCLONE_SHELTER_CAPACITY)
    return res


def _reasoning(kind: str, row: dict, people: int) -> str:
    parts = [f"{row['level']} {kind} risk ({row['probability']:.0%})", f"{row['population'] / 1e5:.1f} lakh people"]
    if kind == "flood" and row["low_lying_pct"] >= 10:
        parts.append(f"{row['low_lying_pct']:.0f}% low-lying land")
    text = " + ".join(parts)
    if people == 0:
        return text + " → monitor, no resources committed"
    return text + f" → {people:,} people may need assistance"


def recommend(kind: str, predictions: dict[str, Any], homeless: dict[str, Any], days: int = DEFAULT_DAYS) -> dict[str, Any]:
    """Preparedness actions and a response estimate for every region of one hazard."""
    if kind not in TYPES:
        raise ValueError(f"Unknown hazard '{kind}'. Use one of: {', '.join(TYPES)}")
    if not 1 <= days <= MAX_DAYS:
        raise ValueError(f"days must be between 1 and {MAX_DAYS}")
    rows = []
    for d in predictions["districts"]:
        level = d["level"]
        people = round(d["population"] * EXPOSURE[kind][level])
        rows.append({
            "region": _name(d),
            "level": level,
            "probability": d["probability"],
            "population": d["population"],
            "households": d.get("households"),
            "low_lying_pct": d.get("low_lying_pct"),
            "tier": TIER[level],
            "response_label": RESPONSE_TIER_LABEL[TIER[level]],
            "preparedness_label": PREPAREDNESS_TIER_LABEL[TIER[level]],
            "summary": d.get("summary"),
            "observed": d.get("observed"),
            "resources": _resources(kind, d, people, days, homeless["value"]),
            "actions": preparedness(kind, d),
        })
    rows.sort(key=lambda r: (r["tier"], -r["resources"]["people"], -r["probability"], r["region"]))
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
        row["reasoning"] = _reasoning(kind, row, row["resources"]["people"])

    keys = rows[0]["resources"].keys() if rows else []
    totals = {k: sum(r["resources"][k] for r in rows) for k in keys}
    return {
        "type": kind,
        "scenario": predictions["scenario"],
        "kind": predictions["kind"],
        "window_start": predictions["window_start"],
        "as_of": predictions["as_of"],
        "days": days,
        "region_kind": "district" if kind == "flood" else "state or union territory",
        "regions": rows,
        "totals": totals,
        "tiers": {
            "response": {label: sum(1 for r in rows if r["tier"] == tier) for tier, label in RESPONSE_TIER_LABEL.items()},
            "preparedness": {label: sum(1 for r in rows if r["tier"] == tier)
                             for tier, label in PREPAREDNESS_TIER_LABEL.items()},
        },
        "rules": [{"id": r["id"], "category": r["category"], "action": r["action"], "min_level": r["min_level"],
                   "basis": r["basis"]} for r in RULES[kind]],
        "parameters": PARAMETERS,
        "exposure": EXPOSURE[kind],
        "homeless_share": homeless,
        "formula": _formula(kind),
        "not_included": [
            {"metric": "Existing shelter capacity, stock on hand and teams already deployed",
             "reason": "Operational data held by the State Disaster Management Authority, not public, so needs are "
                       "not netted against what is already in place."},
            {"metric": "Which part of a state an event will hit",
             "reason": "Regions are whole " + ("districts" if kind == "flood" else "states") + "; a single "
                       "event usually affects only part of one. Population is Census 2011."},
            {"metric": "Road access and evacuation time",
             "reason": "No public dataset used; needed to confirm that routes and shelters are usable."},
        ],
    }


def _formula(kind: str) -> list[str]:
    lines = [
        "people = population × exposure share for the risk level",
        "medical teams = ⌈people × 2% ÷ 50⌉",
        "food rations = people × days",
        "water (L) = people × 15 × days",
        "shelter places = people; floor space = people × 3.5 m²",
    ]
    special = {
        "flood": ["rescue boats = ⌈people × low-lying share ÷ 200⌉",
                  "long-stay places = people × EM-DAT homeless share"],
        "earthquake": ["search-and-rescue teams = ⌈people ÷ 5,000⌉"],
        "cyclone": ["cyclone shelters = ⌈people ÷ 1,000⌉"],
    }[kind]
    return lines[:1] + special + lines[1:] + [
        "order = risk level, then people needing assistance, then the level's probability"]
