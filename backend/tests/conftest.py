"""Shared pytest fixtures.

The suite runs against the real corpus and the real model bundle when they are
present (that is what the endpoints serve), but every fixture is session-scoped
so the 6-second warm-up happens once.
"""

from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.etl import load_clean_data
from backend.services.analytics import build_analytics


@pytest.fixture(scope="session")
def df() -> pd.DataFrame:
    """The cleaned corpus."""
    return load_clean_data()


@pytest.fixture(scope="session")
def analytics(df: pd.DataFrame):
    """Precomputed analytics over the corpus."""
    return build_analytics(df)


@pytest.fixture(scope="session")
def client() -> TestClient:
    """A TestClient with the application lifespan executed (caches warm)."""
    from backend.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def model_available(client: TestClient) -> bool:
    """Whether a model bundle loaded, so model tests can skip cleanly."""
    return bool(client.get("/health").json()["model_loaded"])


@pytest.fixture
def sample_frame() -> pd.DataFrame:
    """A tiny hand-built frame for ETL and analytics unit tests."""
    return pd.DataFrame(
        {
            "id": [1, 2, 3],
            "message": [
                "We need water in Leogane",
                "Flooding in Sindh, boats needed",
                "Random chatter about football",
            ],
            "original": [None, None, None],
            "genre": ["direct", "news", "social"],
            "related": [1, 1, 0],
            "request": [1, 1, 0],
            "water": [1, 0, 0],
            "floods": [0, 1, 0],
            "is_irrelevant": [0, 0, 1],
            "message_length": [24, 30, 29],
            "event": ["Haiti earthquake", "Pakistan floods", "Other"],
            "event_method": ["keyword", "keyword", "default"],
        }
    )
