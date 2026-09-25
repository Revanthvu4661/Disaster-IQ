"""Application state: the historical store and its precomputed analytics.

Everything expensive is built once during startup and shared by the routers,
instead of being recomputed per request.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException

from backend.data_pipeline import load_store
from backend.services.flood_risk import FloodModel, load_flood_model
from backend.services.hazard_risk import HazardRisk, load_hazard_risk
from backend.services.history import History, build_history

logger = logging.getLogger(__name__)


@dataclass
class AppState:
    """Holds the singletons for the lifetime of the process."""

    history: History | None = None
    flood: FloodModel | None = None
    hazard: HazardRisk | None = None
    errors: dict[str, str] = field(default_factory=dict)

    def warm(self) -> None:
        """Load the store, precompute every payload and fit the flood model.

        Failures are recorded, so one broken component never takes the API down.
        """
        try:
            self.history = build_history(load_store())
        except Exception as exc:  # noqa: BLE001 - keep the API up to report it
            logger.exception("startup: historical analytics failed")
            self.errors["history"] = str(exc)
        try:
            self.flood = load_flood_model()
        except Exception as exc:  # noqa: BLE001
            logger.exception("startup: flood risk model failed")
            self.errors["flood"] = str(exc)
        try:
            self.hazard = load_hazard_risk()
        except Exception as exc:  # noqa: BLE001
            logger.exception("startup: hazard risk index failed")
            self.errors["hazard"] = str(exc)

    def reset(self) -> None:
        self.history = None
        self.flood = None
        self.hazard = None
        self.errors = {}

    def require_history(self) -> History:
        if self.history is None:
            raise HTTPException(
                status_code=503,
                detail=self.errors.get(
                    "history",
                    "Historical data is not loaded. Run: python -m backend.data_pipeline",
                ),
            )
        return self.history

    def require_flood(self) -> FloodModel:
        if self.flood is None:
            raise HTTPException(
                status_code=503,
                detail=self.errors.get(
                    "flood",
                    "The flood risk model is not loaded. Run: python -m backend.flood_pipeline",
                ),
            )
        return self.flood

    def require_hazard(self) -> HazardRisk:
        if self.hazard is None:
            raise HTTPException(
                status_code=503,
                detail=self.errors.get(
                    "hazard",
                    "The hazard risk index is not loaded. Run: python -m backend.hazard_pipeline",
                ),
            )
        return self.hazard

    def health(self, version: str) -> dict[str, Any]:
        history = self.history
        return {
            "status": "ok" if history is not None else "degraded",
            "service": "DisasterIQ API",
            "version": version,
            "analytics_ready": history is not None,
            "flood_model_ready": self.flood is not None,
            "hazard_index_ready": self.hazard is not None,
            "records": int(len(history.records)) if history is not None else None,
            "data_built_at": history.meta.get("built_at") if history is not None else None,
        }


#: Module-level singleton, populated by the FastAPI lifespan handler.
state = AppState()
