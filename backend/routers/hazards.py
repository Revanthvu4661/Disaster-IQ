"""Live hazard feed proxy."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from backend import schemas
from backend.services.hazards import fetch_hazards

router = APIRouter(prefix="/api/hazards", tags=["hazards"])


@router.get("", response_model=schemas.HazardsResponse)
def hazards(
    india_only: bool = Query(False, description="Restrict to the India bounding box"),
    source: str | None = Query(None, description="usgs | eonet | gdacs"),
    refresh: bool = Query(False, description="Bypass the ten-minute cache"),
) -> dict[str, Any]:
    """Current hazards from USGS, NASA EONET and GDACS.

    Always returns 200: per-source ``status`` reports which feeds answered, so
    the UI can show an offline or partial state.
    """
    payload = fetch_hazards(force=refresh)
    rows = payload["hazards"]
    if india_only:
        rows = [h for h in rows if h["in_india"]]
    if source:
        rows = [h for h in rows if h["source"] == source]
    return {**payload, "hazards": rows}
