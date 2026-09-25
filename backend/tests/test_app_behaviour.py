"""Application-level behaviour: CORS config, middleware, health."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings


# ── configuration ────────────────────────────────────────────────────────────


def test_default_origins_are_explicit_not_wildcard(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    settings = Settings()
    assert "*" not in settings.cors_origins
    assert settings.cors_allow_credentials is True


def test_wildcard_origin_disables_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """`allow_origins=["*"]` with credentials is rejected by browsers."""
    monkeypatch.setenv("CORS_ORIGINS", "*")
    settings = Settings()
    assert settings.cors_origins == ["*"]
    assert settings.cors_allow_credentials is False


def test_origins_are_parsed_from_a_comma_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "https://a.example , https://b.example")
    assert Settings().cors_origins == ["https://a.example", "https://b.example"]


def test_cors_headers_are_returned_for_an_allowed_origin(client: TestClient) -> None:
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_cors_headers_are_absent_for_an_unknown_origin(client: TestClient) -> None:
    response = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in response.headers


# ── middleware ───────────────────────────────────────────────────────────────


def test_responses_carry_a_duration_header(client: TestClient) -> None:
    response = client.get("/health")
    assert float(response.headers["X-Response-Time-ms"]) >= 0


def test_health_reports_readiness(client: TestClient) -> None:
    body = client.get("/health").json()
    assert set(body) >= {"status", "version", "analytics_ready", "flood_model_ready", "hazard_index_ready", "records", "data_built_at"}
    assert body["version"].startswith("5.")
    assert body["analytics_ready"] is True
    assert body["flood_model_ready"] is True
    assert body["hazard_index_ready"] is True
