"""Live disaster events for the World Map and the per-disaster live panels."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend import disaster_types
from backend.live_feeds import get_live

router = APIRouter(prefix="/api/live", tags=["live"])


@router.get("/events")
def events(
    type: str | None = Query(None, description="One of the five disaster type ids"),
    refresh: bool = Query(False, description="Bypass the ten-minute cache"),
) -> dict[str, Any]:
    """Merged current events from USGS, GDACS and NASA EONET.

    Always 200. ``sources`` reports each feed's status and ``layers`` rolls it up
    per disaster type, so a failed feed shows as unavailable, never as "no
    events".
    """
    if type is not None and type not in disaster_types.BY_ID:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown disaster type '{type}'. Use one of: " + ", ".join(disaster_types.IDS),
        )
    payload = get_live(force=refresh)
    if type is None:
        return payload
    return {
        **payload,
        "events": [e for e in payload["events"] if e["type"] == type],
        "layers": {type: payload["layers"][type]},
    }


@router.get("/summary")
def summary() -> dict[str, Any]:
    """Counts only: current events per type plus layer and source status."""
    payload = get_live()
    return {
        "layers": payload["layers"],
        "sources": [{k: s[k] for k in ("id", "name", "status", "count")} for s in payload["sources"]],
        "fetched_at": payload["fetched_at"],
    }
