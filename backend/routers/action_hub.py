"""Action Hub: high-risk areas and the needs list for one area (data itself lives in Firestore)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from backend.services import action_hub
from backend.state import state

router = APIRouter(prefix="/api/action-hub", tags=["action hub"])


@router.get("/risk-areas")
def risk_areas() -> dict[str, Any]:
    """Level 2 areas at high or critical risk: flood districts, earthquake and cyclone states."""
    hazard = state.require_hazard()
    rows = action_hub.risk_areas(
        state.require_flood().predictions("current"),
        {name: hazard.predictions(name) for name in ("earthquake", "cyclone")},
    )
    return {"areas": rows}


@router.get("/needs")
def needs(
    area: str = Query(..., max_length=120),
    state_name: str = Query(..., alias="state", max_length=120),
    hazard: str = Query(...),
    level: str = Query("high", max_length=20),
    population: int | None = Query(None, ge=0),
) -> dict[str, Any]:
    """Preparedness and response needs for one area, from Gemini or the fixed fallback list."""
    return action_hub.needs(area, state_name, hazard, level, population)
