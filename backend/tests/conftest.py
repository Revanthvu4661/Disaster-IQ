"""Shared pytest fixtures.

The suite runs against the committed clean data (``backend/data/clean/``),
which is what the API serves, so no network is needed. Fixtures are
session-scoped so the store is loaded and analysed once.
"""

from __future__ import annotations

import os

# Live feeds are tested offline with a mock transport; never prefetch at startup.
os.environ.setdefault("LIVE_PREFETCH", "false")

import pytest
from fastapi.testclient import TestClient

from backend.data_pipeline import load_store
from backend.services.history import build_history


@pytest.fixture(scope="session")
def tables() -> dict:
    """Every table of the SQLite store."""
    return load_store()


@pytest.fixture(scope="session")
def history(tables: dict):
    """Precomputed historical analytics."""
    return build_history(tables)


@pytest.fixture(scope="session")
def client() -> TestClient:
    """A TestClient with the application lifespan executed (caches warm)."""
    from backend.main import app

    with TestClient(app) as test_client:
        yield test_client
