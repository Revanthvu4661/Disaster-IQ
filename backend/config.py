"""Environment-driven settings for the DisasterIQ backend."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"


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

        # SQLite store built by backend/data_pipeline.py from backend/data/clean/.
        self.db_path: Path = Path(os.getenv("DB_PATH", str(DATA_DIR / "disasters.db")))
        self.warm_cache: bool = os.getenv("WARM_CACHE", "true").lower() == "true"

        self.hazards_enabled: bool = os.getenv("HAZARDS_ENABLED", "true").lower() == "true"

        # Live disaster feeds (backend/live_feeds.py): per-source TTL and timeout.
        self.live_ttl_seconds: int = int(os.getenv("LIVE_TTL_SECONDS", "600"))
        self.live_timeout_seconds: float = float(os.getenv("LIVE_TIMEOUT_SECONDS", "12"))
        self.live_prefetch: bool = os.getenv("LIVE_PREFETCH", "true").lower() == "true"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()
