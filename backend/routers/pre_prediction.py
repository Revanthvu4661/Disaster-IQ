"""Pre-Prediction: historical factors, same-season history and the AI narrative."""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.services import pre_prediction

router = APIRouter(prefix="/api/pre-prediction", tags=["pre-prediction"])


@router.get("/regions")
def regions() -> dict[str, Any]:
    """The 36 Indian states and union territories, with centroid and (if coastal) a sea point."""
    return {"regions": pre_prediction.region_list()}


@router.get("/baseline")
def baseline(
    region: str,
    days: int = Query(30, description="Forecast window: 7, 30 or 90 days."),
    start: date | None = Query(None, description="First day of the window; defaults to today."),
) -> dict[str, Any]:
    """Historical frequency, seasonality and geographic vulnerability per hazard, and same-season counts."""
    return pre_prediction.baseline(region, start or date.today(), days)


@router.get("/narrative")
def narrative(
    region: str,
    season: str,
    days: int,
    precip: float | None = None,
    wind: float | None = None,
    soil: float | None = None,
    seismic: str = "",
) -> dict[str, Any]:
    """Gemini's analyst narrative for these readings. The prompt is built here, never sent by the page."""
    if days not in (7, 30, 90):
        raise HTTPException(status_code=400, detail="days must be 7, 30 or 90.")
    try:
        return pre_prediction.narrative(region, season[:40], days, precip, wind, soil, seismic[:120])
    except pre_prediction.NarrativeUnavailable as error:
        raise HTTPException(status_code=error.status, detail=str(error)) from error
