"""Application-level behaviour: CORS config, rate limiting, auto-training."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.rate_limit import SLOWAPI_AVAILABLE
from backend.services import model_service as ms


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


def test_rate_limiting_is_installed(client: TestClient) -> None:
    if not SLOWAPI_AVAILABLE:
        pytest.skip("slowapi is not installed")
    assert client.app.state.limiter is not None


# ── model bundle lifecycle ───────────────────────────────────────────────────


def test_missing_bundle_triggers_training_when_allowed(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    """A missing artifact must train rather than serve a 500 forever."""
    called = {}

    def fake_train(fast: bool = False):
        called["fast"] = fast
        return {"schema_version": ms.BUNDLE_SCHEMA_VERSION, "trained": True}

    import backend.model.train_model as train_module

    monkeypatch.setattr(train_module, "train", fake_train)
    bundle = ms.load_bundle(path=tmp_path / "missing.joblib", allow_train=True)
    assert bundle["trained"] is True
    assert called["fast"] is True


def test_stale_sklearn_version_triggers_a_retrain(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    import joblib

    import backend.model.train_model as train_module

    path = tmp_path / "old.joblib"
    joblib.dump(
        {
            "schema_version": ms.BUNDLE_SCHEMA_VERSION,
            "sklearn_version": "0.24.0",
            "predictor": None,
            "category_names": [],
            "thresholds": [],
        },
        path,
    )
    monkeypatch.setattr(
        train_module, "train", lambda fast=False: {"retrained": True}
    )
    assert ms.load_bundle(path=path, allow_train=True) == {"retrained": True}


def test_health_reports_a_degraded_state(client: TestClient) -> None:
    body = client.get("/health").json()
    assert set(body) >= {"status", "version", "model_loaded", "analytics_ready", "rows"}
    assert body["version"].startswith("2.")
