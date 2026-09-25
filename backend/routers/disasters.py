"""Historical impact analytics per disaster type, served from the startup cache."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from backend import disaster_types
from backend.state import state

router = APIRouter(prefix="/api/disasters", tags=["disasters"])


def _unknown(disaster_id: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=f"Unknown disaster type '{disaster_id}'. Use one of: " + ", ".join(disaster_types.IDS),
    )


@router.get("/types")
def types() -> list[dict[str, Any]]:
    """The five disaster types, in display order, with their data mapping."""
    return [disaster_types.as_dict(d) for d in disaster_types.DISASTER_TYPES]


@router.get("/overview")
def overview() -> dict[str, Any]:
    """Cross-type comparison table, global severity ranking, global trend, coverage."""
    return state.require_history().overview


@router.get("/{disaster_id}")
def disaster(disaster_id: str) -> dict[str, Any]:
    """The eight analysis blocks for one type: human, economic, frequency,
    geography, severity, time, correlation, recovery."""
    payload = state.require_history().types.get(disaster_id)
    if payload is None:
        raise _unknown(disaster_id)
    return payload
