"""Action Hub: the high-risk areas to act on, and a needs list for each.

Everything the Action Hub stores (responders, action plans, tasks, updates)
lives in the project's Firebase Cloud Firestore and is read and written by the
page itself. The backend only serves what needs the project's data or a secret:

    risk areas   Level 2 regions at high or critical risk: flood districts from
                 the current flood model, earthquake and cyclone states from the
                 long-run hazard index.
    needs        A preparedness and response needs list for one area, written by
                 Gemini (the key stays here) or, when Gemini is not configured or
                 fails, a fixed list per hazard.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from backend.services import gemini

logger = logging.getLogger("disasteriq.action_hub")

HAZARDS = ("flood", "cyclone", "earthquake")
LEVELS = ("critical", "high")
CATEGORIES = ("transport", "medical", "rescue", "shelter", "food", "water", "communication", "power")
PRIORITIES = ("Critical", "High", "Medium")
MAX_NEEDS = 8


def risk_areas(flood: dict[str, Any], hazard_index: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """High and critical areas across the three hazards, most severe first, then by population."""
    rows: list[dict[str, Any]] = []
    for row in flood["districts"]:
        if row["level"] in LEVELS:
            rows.append({
                "area": row["district"], "state": row["state"], "hazard": "flood", "level": row["level"],
                "probability": row["probability"], "population": row.get("population"),
                "updated": row["as_of"], "basis": "Flood model, latest 30 days",
                "lat": row.get("lat"), "lon": row.get("lon"),
            })
    for hazard in ("earthquake", "cyclone"):
        payload = hazard_index[hazard]
        for row in payload["districts"]:
            if row["level"] in LEVELS:
                rows.append({
                    "area": row["region"], "state": row["region"], "hazard": hazard, "level": row["level"],
                    "probability": row["probability"], "population": row.get("population"),
                    "updated": f"{payload['window_start']}–{payload['as_of']}", "basis": "Long-run hazard index",
                    "lat": row.get("lat"), "lon": row.get("lon"),
                })
    order = {"critical": 0, "high": 1}
    rows.sort(key=lambda r: (order[r["level"]], -(r["population"] or 0)))
    for row in rows:
        row["id"] = f"{row['hazard']}:{row['state']}:{row['area']}"
    return rows


# ── needs ─────────────────────────────────────────────────────────────────

def _need(need: str, category: str, quantity: str, priority: str, source_hint: str = "", target_hint: str = "") -> dict:
    return {"need": need, "category": category, "quantity": quantity, "priority": priority,
            "from_hint": source_hint, "to_hint": target_hint}


#: Used when Gemini is not configured or fails. General practice, not tailored to the area.
FALLBACK: dict[str, list[dict[str, str]]] = {
    "flood": [
        _need("Pre-position rescue boats and life jackets", "rescue", "1 boat per 200 people on low-lying land", "Critical",
              "District boat depot", "Low-lying villages"),
        _need("Move medical supplies to relief camps", "medical", "ORS, antibiotics and first-aid kits for 5,000 people", "Critical",
              "District hospital store", "Relief camps"),
        _need("Set up relief camps on high ground", "shelter", "Space for 3.5 m² per person", "High",
              "Block office", "Schools and community halls on high ground"),
        _need("Stock drinking water and purification tablets", "water", "15 L per person per day for 7 days", "High",
              "Water board depot", "Relief camps"),
        _need("Distribute dry food rations", "food", "One 2,100 kcal ration per person per day", "High",
              "Public distribution warehouse", "Relief camps"),
        _need("Arrange transport for evacuation", "transport", "Buses and tractors for low-lying villages", "Critical",
              "Transport depot", "Evacuation points"),
        _need("Set up emergency communication", "communication", "Satellite phones and radio sets for each block", "Medium",
              "District control room", "Block offices"),
    ],
    "cyclone": [
        _need("Evacuate coastal villages to cyclone shelters", "transport", "Buses for everyone within 5 km of the coast", "Critical",
              "Transport depot", "Cyclone shelters"),
        _need("Stock cyclone shelters with food and water", "food", "Rations and water for 3 days per sheltered person", "Critical",
              "Public distribution warehouse", "Cyclone shelters"),
        _need("Move medical teams and supplies to shelters", "medical", "One mobile medical team per 5,000 people", "High",
              "District hospital", "Cyclone shelters"),
        _need("Pre-position tree-cutting and road-clearing teams", "rescue", "One team per block with chainsaws", "High",
              "Public works depot", "Main coastal roads"),
        _need("Arrange backup power for hospitals and shelters", "power", "Generators and fuel for 72 hours", "High",
              "Electricity board store", "Hospitals and shelters"),
        _need("Broadcast early warnings to fishing communities", "communication", "Sirens, SMS and volunteer runners", "Critical",
              "District control room", "Fishing harbours"),
    ],
    "earthquake": [
        _need("Pre-position search-and-rescue teams and equipment", "rescue", "One team per 5,000 people, with cutters and jacks", "Critical",
              "State disaster response force base", "Dense urban wards"),
        _need("Stock trauma kits at hospitals", "medical", "Trauma and surgical kits for 1,000 casualties", "Critical",
              "Central medical store", "District hospitals"),
        _need("Set up emergency shelters and tents", "shelter", "Tents at 3.5 m² per displaced person", "High",
              "Relief material depot", "Open grounds"),
        _need("Stock drinking water", "water", "15 L per person per day for 7 days", "High",
              "Water board depot", "Open grounds and shelters"),
        _need("Arrange heavy machinery for debris clearing", "transport", "Excavators and cranes on standby", "High",
              "Public works depot", "Dense urban wards"),
        _need("Set up emergency communication", "communication", "Satellite phones for the control room and hospitals", "Medium",
              "District control room", "Hospitals"),
    ],
}

PROMPT = (
    "You are a disaster response planner in India. Area: {area}, {state}. Hazard: {hazard}. "
    "Risk level: {level}. Population: {population}. List {count} concrete preparedness and response needs "
    "that a district coordinator could assign to people now. Respond ONLY with JSON: "
    '{{"needs": [{{"need": "short imperative task, under 70 characters", '
    '"category": "one of transport|medical|rescue|shelter|food|water|communication|power", '
    '"quantity": "how much, sized to the population", "priority": "Critical|High|Medium", '
    '"from_hint": "where the items or people come from", "to_hint": "where they go"}}]}}'
)


def _clean(items: Any) -> list[dict[str, str]]:
    if isinstance(items, dict):
        items = items.get("needs")
    if not isinstance(items, list):
        raise gemini.GeminiUnavailable("The AI needs list could not be read. Try again.", 502)
    out = []
    for item in items[:MAX_NEEDS]:
        if not isinstance(item, dict) or not str(item.get("need", "")).strip():
            continue
        category = str(item.get("category", "")).lower().strip()
        priority = str(item.get("priority", "")).strip().capitalize()
        out.append(_need(
            str(item["need"]).strip()[:120],
            category if category in CATEGORIES else "transport",
            str(item.get("quantity", "")).strip()[:160],
            priority if priority in PRIORITIES else "High",
            str(item.get("from_hint", "")).strip()[:120],
            str(item.get("to_hint", "")).strip()[:120],
        ))
    if not out:
        raise gemini.GeminiUnavailable("The AI returned no usable needs.", 502)
    return out


def needs(area: str, state: str, hazard: str, level: str, population: int | None,
          client: httpx.Client | None = None) -> dict[str, Any]:
    """A needs list for one area: Gemini's, or the fixed list for the hazard with the reason."""
    if hazard not in HAZARDS:
        raise ValueError(f"hazard must be one of {', '.join(HAZARDS)}.")
    base = {"area": area, "state": state, "hazard": hazard, "level": level, "population": population}
    prompt = PROMPT.format(area=area, state=state, hazard=hazard, level=level,
                           population=f"{population:,}" if population else "unknown", count=7)
    try:
        items = _clean(gemini.generate_json(prompt, client, what="The AI needs list"))
        return {**base, "needs": _numbered(items), "source": "gemini", "model": gemini.model(), "fallback_reason": None}
    except gemini.GeminiUnavailable as error:
        logger.info("needs for %s fall back to the fixed list: %s", area, error)
        return {**base, "needs": _numbered(FALLBACK[hazard]), "source": "fallback", "model": None,
                "fallback_reason": str(error)}


def _numbered(items: list[dict[str, str]]) -> list[dict[str, str]]:
    return [{"id": f"n{index + 1}", **item} for index, item in enumerate(items)]
