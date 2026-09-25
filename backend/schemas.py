"""Response models for the endpoints whose shape is fixed and small.

The analytics payloads are large nested dicts built in
``backend/services/history.py`` and documented there and in
``docs/DATA_SOURCES.md``; they are returned as plain JSON.
"""

from __future__ import annotations

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    service: str = "DisasterIQ API"
    version: str
    analytics_ready: bool
    flood_model_ready: bool = False
    hazard_index_ready: bool = False
    records: int | None = None
    data_built_at: str | None = None
