"""Action Hub: risk areas from Level 2, and the needs list (Gemini mocked, fallback without a key)."""

from __future__ import annotations

import json

import httpx

from backend.config import get_settings
from backend.services import action_hub


def test_risk_areas_are_high_or_critical_and_ordered(client):
    areas = client.get("/api/action-hub/risk-areas").json()["areas"]
    assert areas, "expected at least one high-risk area"
    assert {a["level"] for a in areas} <= {"critical", "high"}
    assert {a["hazard"] for a in areas} <= {"flood", "cyclone", "earthquake"}
    levels = [a["level"] for a in areas]
    assert levels == sorted(levels, key=lambda level: level != "critical")
    first = areas[0]
    assert first["id"] == f"{first['hazard']}:{first['state']}:{first['area']}"
    assert {"area", "state", "population", "updated", "basis"} <= set(first)


def test_needs_fall_back_to_the_fixed_list_without_a_key(client):
    body = client.get("/api/action-hub/needs",
                      params={"area": "Odisha", "state": "Odisha", "hazard": "cyclone", "level": "critical"}).json()
    assert body["source"] == "fallback"
    assert "GEMINI_API_KEY" in body["fallback_reason"]
    assert [n["id"] for n in body["needs"]] == [f"n{i + 1}" for i in range(len(action_hub.FALLBACK["cyclone"]))]


def test_needs_rejects_an_unknown_hazard(client):
    response = client.get("/api/action-hub/needs", params={"area": "X", "state": "X", "hazard": "tsunami"})
    assert response.status_code == 400


def test_needs_from_gemini_are_cleaned(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key")
    answer = {"needs": [
        {"need": "Move medical supplies", "category": "Medical", "quantity": "500 units", "priority": "critical",
         "from_hint": "Pharmacy Row", "to_hint": "Safe Zone B"},
        {"need": "Clear roads", "category": "bulldozing", "quantity": "", "priority": "urgent"},
        {"need": "  ", "category": "food"},
        "not a need",
    ]}
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["prompt"] = json.loads(request.content)["contents"][0]["parts"][0]["text"]
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(answer)}]}}]})

    result = action_hub.needs("Kakinada", "Andhra Pradesh", "cyclone", "critical", 1_500_000,
                              client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert "Area: Kakinada, Andhra Pradesh. Hazard: cyclone. Risk level: critical. Population: 1,500,000" in seen["prompt"]
    assert result["source"] == "gemini"
    assert [n["need"] for n in result["needs"]] == ["Move medical supplies", "Clear roads"]
    assert result["needs"][0] == {"id": "n1", "need": "Move medical supplies", "category": "medical",
                                  "quantity": "500 units", "priority": "Critical",
                                  "from_hint": "Pharmacy Row", "to_hint": "Safe Zone B"}
    # Unknown category and priority fall back to safe defaults.
    assert result["needs"][1]["category"] == "transport" and result["needs"][1]["priority"] == "High"


def test_needs_fall_back_when_gemini_errors(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test-key")
    client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(429, text="quota")))
    result = action_hub.needs("Puri", "Odisha", "flood", "high", None, client=client)
    assert result["source"] == "fallback"
    assert "HTTP 429" in result["fallback_reason"]
