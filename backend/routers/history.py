"""Historical event locations for the World Map's historical layer."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend import disaster_types
from backend.state import state

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("/map")
def history_map(
    decade: int = Query(..., description="First year of the decade, e.g. 1990"),
    types: str | None = Query(None, description="Comma-separated type ids; all five when omitted"),
) -> dict[str, Any]:
    """Point layers (USGS earthquakes, IBTrACS cyclones) and country-centroid
    layers (EM-DAT floods) for one decade."""
    history = state.require_history()
    if decade not in history.decades():
        raise HTTPException(
            status_code=404,
            detail=f"No data for the {decade}s. Available: {', '.join(map(str, history.decades()))}",
        )
    wanted = [t.strip() for t in types.split(",") if t.strip()] if types else disaster_types.IDS
    unknown = [t for t in wanted if t not in disaster_types.BY_ID]
    if unknown:
        raise HTTPException(status_code=404, detail=f"Unknown disaster type(s): {', '.join(unknown)}")
    return history.map_payload(decade, wanted)
