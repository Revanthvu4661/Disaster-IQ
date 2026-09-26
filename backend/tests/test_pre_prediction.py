"""Pre-Prediction: historical factors, same-season history and the Gemini proxy (mocked)."""

from __future__ import annotations

import json
from datetime import date

import httpx
import pytest

from backend.config import get_settings
from backend.services import pre_prediction as pp


def test_regions_lists_every_state_with_coast_and_sea_point(client):
    regions = client.get("/api/pre-prediction/regions").json()["regions"]
    assert len(regions) == 36
    odisha = next(r for r in regions if r["region"] == "Odisha")
    delhi = next(r for r in regions if r["region"] == "Delhi")
    assert odisha["coastal"] and odisha["sea_point"] == [15.0, 87.0]
    assert not delhi["coastal"] and delhi["sea_point"] is None


def test_baseline_factors_are_between_zero_and_one(client):
    body = client.get("/api/pre-prediction/baseline", params={"region": "Odisha", "days": 30, "start": "2026-09-26"}).json()
    assert body["months"] == [9, 10]
    for hazard in ("flood", "cyclone", "earthquake"):
        factors = body["hazards"][hazard]
        assert 0 <= factors["frequency"] <= 1
        assert 0 <= factors["geography"] <= 1
        assert len(factors["history"]["per_year"]) == 10
    assert body["hazards"]["earthquake"]["monthly_share"] is None
    assert sum(body["hazards"]["cyclone"]["monthly_share"]) == pytest.approx(1, abs=0.01)


def test_history_counts_only_the_window_months_and_marks_the_trend():
    # Cyclone Fani formed on 26 April 2019 and hit Odisha in May. Storms are dated by formation.
    base = pp.baseline("Odisha", date(2026, 4, 20), 30)
    history = base["hazards"]["cyclone"]["history"]
    assert base["months"] == [4, 5]
    assert any(item["year"] == 2019 and item["count"] >= 1 for item in history["per_year"])
    assert history["trend"] in {"up", "down", "flat"}
    assert history["total"] == sum(item["count"] for item in history["per_year"])


def test_cyclone_months_come_from_the_storm_id():
    assert pp._storm_month("1999286N17087") == 10
    assert pp._storm_month("bad") is None


def test_baseline_rejects_unknown_region_and_window(client):
    assert client.get("/api/pre-prediction/baseline", params={"region": "Atlantis"}).status_code == 400
    assert client.get("/api/pre-prediction/baseline", params={"region": "Goa", "days": 12}).status_code == 400


def test_narrative_without_a_key_says_it_is_not_configured(client):
    response = client.get("/api/pre-prediction/narrative",
                          params={"region": "Odisha", "season": "Post-monsoon", "days": 7})
    assert response.status_code == 503
    assert "GEMINI_API_KEY" in response.json()["detail"]


def test_narrative_builds_the_prompt_and_reads_the_json(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key")
    pp._cache.clear()
    seen = {}
    answer = {"overall_risk": "High", "most_likely_disaster": "Flood", "risk_factors": ["Heavy rain", "Saturated soil"],
              "estimated_affected_population": "2 lakh", "confidence": "Medium", "narrative": "Rain is heavy.",
              "immediate_actions": ["Open relief camps"]}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.headers["x-goog-api-key"]
        seen["prompt"] = json.loads(request.content)["contents"][0]["parts"][0]["text"]
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(answer)}]}}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    result = pp.narrative("Odisha", "Southwest monsoon", 30, 120.5, 42.0, 0.41, "M4.6 180 km away", client=client)
    assert seen["key"] == "test-key"
    assert "Region: Odisha, Season: Southwest monsoon, Forecast: 30 days" in seen["prompt"]
    assert "Precipitation=120.5mm Wind=42.0km/h Soil Moisture=0.410, Seismic: M4.6 180 km away" in seen["prompt"]
    assert result["most_likely_disaster"] == "Flood"
    assert result["risk_factors"] == ["Heavy rain", "Saturated soil"]
    pp._cache.clear()


def test_narrative_reports_a_bad_answer(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key")
    pp._cache.clear()
    client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(500, text="boom")))
    with pytest.raises(pp.NarrativeUnavailable):
        pp.narrative("Goa", "Winter", 7, None, None, None, "", client=client)
