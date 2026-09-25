"""Level 2 for earthquakes and cyclones: the statistical hazard index per Indian state."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from backend.services.hazard_risk import TESTS
from backend.state import state

router = APIRouter(prefix="/api/hazard-risk", tags=["hazard risk"])


@router.get("/{hazard}")
def hazard_risk(hazard: str) -> dict[str, Any]:
    """Risk level per state, the method and its cut-offs, known-event checks and what is not included."""
    if hazard not in TESTS:
        raise HTTPException(status_code=404, detail=f"Unknown hazard '{hazard}'. Use one of: {', '.join(TESTS)}")
    return state.require_hazard().payloads[hazard]
