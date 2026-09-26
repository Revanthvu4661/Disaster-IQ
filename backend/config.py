"""Environment-driven settings for the DisasterIQ backend."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"


def _split(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


def load_dotenv(path: Path = BASE_DIR / ".env") -> None:
    """Read ``KEY=value`` lines from backend/.env into the environment.

    Plain standard library, no extra package. A variable that is already set
    (for example in Render's dashboard) always wins over the file, and a
    missing file is fine. backend/.env is gitignored: secrets live only there.
    """
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


load_dotenv()


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
        # Last good response of each feed, kept on disk so a feed that is down
        # (NASA EONET often is) still shows its latest events after a restart.
        self.live_cache_dir: Path = Path(
            os.getenv("LIVE_CACHE_DIR", str(DATA_DIR / "live_cache"))
        )

        # Gemini, for the Pre-Prediction page's AI narrative. Server-side only:
        # the key is sent in a request header and never reaches the browser.
        self.gemini_api_key: str = os.getenv("GEMINI_API_KEY", "").strip()
        self.gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()
