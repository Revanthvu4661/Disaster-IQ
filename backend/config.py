"""Environment-driven settings for the DisasterIQ backend."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
MODEL_DIR = BASE_DIR / "model"


def _split(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


class Settings:
    """Runtime configuration, all overridable through environment variables."""

    def __init__(self) -> None:
        self.env: str = os.getenv("DISASTERIQ_ENV", "development")
        self.log_level: str = os.getenv("LOG_LEVEL", "INFO").upper()

        # CORS. allow_credentials with a wildcard origin is invalid, so an
        # explicit list is the default and the wildcard disables credentials.
        self.cors_origins: list[str] = _split(
            os.getenv(
                "CORS_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173,"
                "http://localhost:4173,http://127.0.0.1:4173",
            )
        )
        self.cors_allow_credentials: bool = (
            os.getenv("CORS_ALLOW_CREDENTIALS", "true").lower() == "true"
            and "*" not in self.cors_origins
        )

        self.db_path: Path = Path(os.getenv("DB_PATH", str(DATA_DIR / "disaster.db")))
        self.model_path: Path = Path(
            os.getenv("MODEL_PATH", str(MODEL_DIR / "disaster_model.joblib"))
        )
        self.rules_path: Path = Path(
            os.getenv("RULES_PATH", str(DATA_DIR / "recommendation_rules.yaml"))
        )

        self.auto_train: bool = os.getenv("AUTO_TRAIN", "true").lower() == "true"
        self.warm_cache: bool = os.getenv("WARM_CACHE", "true").lower() == "true"

        self.predict_rate_limit: str = os.getenv("PREDICT_RATE_LIMIT", "60/minute")
        self.batch_rate_limit: str = os.getenv("BATCH_RATE_LIMIT", "10/minute")
        self.batch_max_messages: int = int(os.getenv("BATCH_MAX_MESSAGES", "500"))
        self.batch_max_bytes: int = int(os.getenv("BATCH_MAX_BYTES", str(4 * 1024 * 1024)))

        self.hazards_enabled: bool = os.getenv("HAZARDS_ENABLED", "true").lower() == "true"
        self.hazards_ttl_seconds: int = int(os.getenv("HAZARDS_TTL_SECONDS", "600"))
        self.hazards_timeout_seconds: float = float(os.getenv("HAZARDS_TIMEOUT_SECONDS", "6"))

        self.translation_enabled: bool = (
            os.getenv("TRANSLATION_ENABLED", "true").lower() == "true"
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()
