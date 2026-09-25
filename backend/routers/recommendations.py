"""Level 3: preparedness and response recommendations built on the Level 2 risk of each hazard."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.services.recommendations import DEFAULT_DAYS, MAX_DAYS, TYPES, homeless_share, recommend
from backend.state import state

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])


@router.get("/{hazard}")
def recommendations(
    hazard: str,
    scenario: str = Query("current", description="Flood only: `current` or a back-test month such as `2018-08`"),
    days: int = Query(DEFAULT_DAYS, ge=1, le=MAX_DAYS, description="Response planning horizon in days"),
) -> dict[str, Any]:
    """Preparedness actions and a response resource estimate for every region of one hazard."""
    if hazard not in TYPES:
        raise HTTPException(status_code=404, detail=f"Unknown hazard '{hazard}'. Use one of: {', '.join(TYPES)}")
    if hazard == "flood":
        predictions = state.require_flood().predictions(scenario)
    else:
        if scenario != "current":
            raise ValueError("Scenarios apply to floods only; earthquake and cyclone risk is a long-run index.")
        predictions = state.require_hazard().predictions(hazard)
    homeless = homeless_share(state.require_history().records)
    return recommend(hazard, predictions, homeless, days=days)
