"""Application state: the corpus, the precomputed analytics and the model.

Everything expensive is built once during startup and shared by the routers,
instead of being recomputed per request.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import pandas as pd
from fastapi import HTTPException

from backend.config import get_settings
from backend.etl import load_clean_data
from backend.services.analytics import Analytics, build_analytics
from backend.services.model_service import ModelService, load_bundle
from backend.services.recommend import RuleSet, load_rules

logger = logging.getLogger(__name__)


@dataclass
class AppState:
    """Holds the singletons for the lifetime of the process."""

    df: pd.DataFrame | None = None
    analytics: Analytics | None = None
    model: ModelService | None = None
    rules: RuleSet | None = None
    errors: dict[str, str] = field(default_factory=dict)

    # ── lifecycle ─────────────────────────────────────────────────────────
    def warm(self) -> None:
        """Load data, analytics, rules and the model. Failures are recorded."""
        settings = get_settings()
        try:
            self.df = load_clean_data()
            self.analytics = build_analytics(self.df)
        except Exception as exc:  # noqa: BLE001 - keep the API up to report it
            logger.exception("startup: analytics failed")
            self.errors["analytics"] = str(exc)

        try:
            self.rules = load_rules()
        except Exception as exc:  # noqa: BLE001
            logger.exception("startup: rules failed")
            self.errors["rules"] = str(exc)

        try:
            self.model = ModelService(load_bundle(allow_train=settings.auto_train))
        except Exception as exc:  # noqa: BLE001 - analytics still work without it
            logger.exception("startup: model failed")
            self.errors["model"] = str(exc)

    def reset(self) -> None:
        self.df = None
        self.analytics = None
        self.model = None
        self.rules = None
        self.errors = {}

    # ── accessors used by routers ─────────────────────────────────────────
    def require_analytics(self) -> Analytics:
        if self.analytics is None:
            raise HTTPException(
                status_code=503,
                detail=self.errors.get("analytics", "Analytics are not ready yet"),
            )
        return self.analytics

    def require_df(self) -> pd.DataFrame:
        if self.df is None:
            raise HTTPException(
                status_code=503,
                detail=self.errors.get("analytics", "Dataset is not loaded"),
            )
        return self.df

    def require_model(self) -> ModelService:
        if self.model is None:
            raise HTTPException(
                status_code=503,
                detail=self.errors.get(
                    "model",
                    "Model is not available. Run: python -m backend.model.train_model",
                ),
            )
        return self.model

    def require_rules(self) -> RuleSet:
        if self.rules is None:
            raise HTTPException(
                status_code=503, detail=self.errors.get("rules", "Rules are not loaded")
            )
        return self.rules

    def health(self, version: str) -> dict[str, Any]:
        return {
            "status": "ok" if self.analytics is not None else "degraded",
            "service": "DisasterIQ API",
            "version": version,
            "model_loaded": self.model is not None,
            "analytics_ready": self.analytics is not None,
            "rows": int(len(self.df)) if self.df is not None else None,
        }


#: Module-level singleton, populated by the FastAPI lifespan handler.
state = AppState()
