"""Level 2: flood risk prediction for the districts of Kerala."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from backend.state import state

router = APIRouter(prefix="/api/flood-risk", tags=["flood risk"])


@router.get("")
def flood_risk() -> dict[str, Any]:
    """Model card, evaluation, back-tests, Kerala-dataset check and current risk per district."""
    return state.require_flood().payload


@router.get("/scenario/{scenario_id}")
def scenario(scenario_id: str) -> dict[str, Any]:
    """District risk for the latest 30 days (`current`) or a back-test month such as `2018-08`."""
    return state.require_flood().predictions(scenario_id)


@router.get("/score")
def score(
    district: str | None = Query(None, description="District name; its latest 30 days fill any feature not given"),
    rain_pct_normal: float | None = Query(None, description="Rainfall in the window, % of normal"),
    max_3day_rain_mm: float | None = Query(None, description="Heaviest 3-day rainfall, mm"),
    soil_wetness_before: float | None = Query(None, description="Root-zone soil wetness before the window, 0-1"),
    elevation_m: float | None = Query(None, description="Mean elevation, m"),
    prior_flood_rate: float | None = Query(None, description="Share of the previous 10 seasons with a flood, 0-1"),
) -> dict[str, Any]:
    """Score one district or a hand-entered set of conditions, with each feature's contribution."""
    return state.require_flood().score(district, {
        "rain_pct_normal": rain_pct_normal,
        "max_3day_rain_mm": max_3day_rain_mm,
        "soil_wetness_before": soil_wetness_before,
        "elevation_m": elevation_m,
        "prior_flood_rate": prior_flood_rate,
    })
