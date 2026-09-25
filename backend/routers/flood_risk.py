"""Level 2: flood risk prediction for the districts of India."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import Response

from backend.state import state

router = APIRouter(prefix="/api/flood-risk", tags=["flood risk"])


def _plain(value: Any) -> Any:
    """numpy numbers to Python ones for json.dumps."""
    return value.item() if hasattr(value, "item") else str(value)


#: The payloads are large (about 700 districts each) and fixed once the model is fitted, so each is
#: encoded to JSON once. Encoding it per request through FastAPI's generic encoder took minutes.
_encoded: dict[tuple[int, str], bytes] = {}


def _json(key: str, build) -> Response:
    model_id = id(state.require_flood())
    cache_key = (model_id, key)
    if cache_key not in _encoded:
        _encoded.clear()
        _encoded[cache_key] = json.dumps(build(), default=_plain, allow_nan=False, separators=(",", ":")).encode()
    return Response(_encoded[cache_key], media_type="application/json")


@router.get("")
def flood_risk() -> Response:
    """Model card, evaluation (overall and per state), back-tests, Kerala-dataset check and current risk per district."""
    return _json("payload", lambda: state.require_flood().payload)


@router.get("/scenario/{scenario_id}")
def scenario(scenario_id: str) -> Response:
    """District risk for the latest 30 days (`current`) or a back-test month such as `2018-08`."""
    model = state.require_flood()
    return _json(f"scenario:{scenario_id}", lambda: model.predictions(scenario_id))


@router.get("/score")
def score(
    district: str | None = Query(None, description="District name; its latest 30 days fill any feature not given"),
    rain_pct_normal: float | None = Query(None, description="Rainfall in the window, % of normal"),
    max_3day_rain_mm: float | None = Query(None, description="Heaviest 3-day rainfall, mm"),
    soil_wetness_before: float | None = Query(None, description="Root-zone soil wetness before the window, 0-1"),
    elevation_m: float | None = Query(None, description="Mean elevation, m"),
    prior_flood_rate: float | None = Query(None, description="Share of the previous 10 years with a flood, 0-1"),
    state_name: str | None = Query(None, alias="state", description="State whose baseline applies when no district is given"),
) -> dict[str, Any]:
    """Score one district or a hand-entered set of conditions, with each feature's contribution."""
    return state.require_flood().score(district, {
        "rain_pct_normal": rain_pct_normal,
        "max_3day_rain_mm": max_3day_rain_mm,
        "soil_wetness_before": soil_wetness_before,
        "elevation_m": elevation_m,
        "prior_flood_rate": prior_flood_rate,
    }, state=state_name)
