"""End-to-end API tests over every endpoint."""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient

URGENT_MESSAGE = (
    "We are trapped under a collapsed building after the earthquake in Leogane, "
    "people are injured and we have no water"
)
QUIET_MESSAGE = "Thanks for the update on the weather forecast this evening"


# ── health ───────────────────────────────────────────────────────────────────


def test_root_and_health(client: TestClient) -> None:
    for path in ("/", "/health"):
        body = client.get(path).json()
        assert body["status"] in {"ok", "degraded"}
        assert body["analytics_ready"] is True
        assert body["rows"] and body["rows"] > 20_000


# ── analytics ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "path",
    [
        "/api/analytics/summary-stats",
        "/api/analytics/category-distribution",
        "/api/analytics/top-categories",
        "/api/analytics/volume-by-event",
        "/api/analytics/volume-by-genre",
        "/api/analytics/event-category-mix",
        "/api/analytics/genre-event-matrix",
        "/api/analytics/category-cooccurrence",
        "/api/analytics/needs-bundles",
        "/api/analytics/message-length",
        "/api/analytics/urgent-terms",
        "/api/analytics/data-quality",
        "/api/analytics/top-terms/water",
    ],
)
def test_analytics_endpoints_return_200(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 200, response.text
    assert response.json() not in (None, "")


def test_top_categories_limit_and_needs_filter(client: TestClient) -> None:
    rows = client.get("/api/analytics/top-categories?limit=5").json()
    assert len(rows) == 5
    needs = client.get("/api/analytics/top-categories?limit=5&needs_only=true").json()
    assert all(r["is_need"] for r in needs)


def test_top_categories_rejects_bad_limit(client: TestClient) -> None:
    assert client.get("/api/analytics/top-categories?limit=99").status_code == 422


def test_volume_by_event_is_events_not_genres(client: TestClient) -> None:
    """Regression: this endpoint used to return genres under an 'event' key."""
    events = {row["event"] for row in client.get("/api/analytics/volume-by-event").json()}
    assert not events & {"direct", "news", "social"}
    assert "Haiti earthquake" in events

    genres = {row["genre"] for row in client.get("/api/analytics/volume-by-genre").json()}
    assert genres == {"direct", "news", "social"}


def test_cooccurrence_is_a_matrix(client: TestClient) -> None:
    payload = client.get("/api/analytics/category-cooccurrence").json()
    n = len(payload["categories"])
    assert len(payload["counts"]) == n
    assert all(len(row) == n for row in payload["counts"])
    assert payload["top_pairs"]


def test_search_endpoint(client: TestClient) -> None:
    payload = client.get("/api/analytics/search?q=water&limit=3").json()
    assert payload["total"] > 0 and len(payload["results"]) <= 3


def test_search_rejects_short_queries(client: TestClient) -> None:
    assert client.get("/api/analytics/search?q=a").status_code == 422


def test_unknown_category_terms_is_empty(client: TestClient) -> None:
    assert client.get("/api/analytics/top-terms/not_a_category").json() == []


# ── prediction ───────────────────────────────────────────────────────────────


def test_predict_urgent_message(client: TestClient, model_available: bool) -> None:
    if not model_available:
        pytest.skip("no model bundle available")
    body = client.post("/api/predict", json={"message": URGENT_MESSAGE}).json()
    assert body["severity"]["level"] in {"high", "critical"}
    assert body["severity"]["score"] >= 45
    assert body["triggered_count"] > 0
    assert body["event"] == "Haiti earthquake"
    assert body["incident_summary"].startswith("INCIDENT SUMMARY")
    assert body["recommendation"]["actions"]
    assert body["predictions"][0]["confidence"] >= body["predictions"][-1]["confidence"]


def test_predict_thresholds_are_per_label(client: TestClient, model_available: bool) -> None:
    if not model_available:
        pytest.skip("no model bundle available")
    predictions = client.post("/api/predict", json={"message": URGENT_MESSAGE}).json()[
        "predictions"
    ]
    thresholds = {p["threshold"] for p in predictions}
    assert len(thresholds) > 1, "thresholds should be tuned per label, not fixed at 0.5"
    for prediction in predictions:
        assert prediction["triggered"] == (
            prediction["confidence"] >= prediction["threshold"]
        )


def test_predict_quiet_message_is_low_or_medium(
    client: TestClient, model_available: bool
) -> None:
    if not model_available:
        pytest.skip("no model bundle available")
    body = client.post("/api/predict", json={"message": QUIET_MESSAGE}).json()
    assert body["severity"]["level"] in {"low", "medium"}


def test_predict_explanations_and_highlights(
    client: TestClient, model_available: bool
) -> None:
    if not model_available:
        pytest.skip("no model bundle available")
    body = client.post("/api/predict", json={"message": URGENT_MESSAGE}).json()
    assert body["explanations"], "the linear explainer should return terms"
    for spans in body["explanations"].values():
        assert all(term["contribution"] > 0 for term in spans)
    for span in body["highlights"]:
        assert body["classified_text"][span["start"] : span["end"]] == span["text"]


def test_predict_explain_can_be_disabled(client: TestClient, model_available: bool) -> None:
    if not model_available:
        pytest.skip("no model bundle available")
    body = client.post(
        "/api/predict", json={"message": URGENT_MESSAGE, "explain": False}
    ).json()
    assert body["explanations"] == {} and body["highlights"] == []


def test_predict_detects_language(client: TestClient, model_available: bool) -> None:
    if not model_available:
        pytest.skip("no model bundle available")
    body = client.post(
        "/api/predict",
        json={"message": "Nou bezwen dlo ak manje nan Jacmel, tanpri ede nou"},
    ).json()
    assert body["language"]["code"] == "ht"
    # Translation may be unavailable offline; the response must still be valid.
    assert body["translation"]["translated"] in {True, False}


@pytest.mark.parametrize("message", ["", "  ", "ab"])
def test_predict_rejects_short_messages(client: TestClient, message: str) -> None:
    assert client.post("/api/predict", json={"message": message}).status_code == 422


def test_predict_rejects_oversized_message(client: TestClient) -> None:
    assert client.post(
        "/api/predict", json={"message": "x" * 5000}
    ).status_code == 422


# ── batch ────────────────────────────────────────────────────────────────────


def test_batch_json(client: TestClient, model_available: bool) -> None:
    if not model_available:
        pytest.skip("no model bundle available")
    body = client.post(
        "/api/predict/batch",
        json={
            "messages": [
                QUIET_MESSAGE,
                URGENT_MESSAGE,
                "We need drinking water and food for fifty families",
            ]
        },
    ).json()
    assert body["count"] == 3
    scores = [item["severity"]["score"] for item in body["items"]]
    assert scores == sorted(scores, reverse=True), "items must be sorted by severity"
    assert sum(body["severity_breakdown"].values()) == 3
    assert body["forecast"]["messages"] == 3
    assert len(body["top_urgent"]) <= 10


def test_batch_rejects_empty_list(client: TestClient) -> None:
    assert client.post("/api/predict/batch", json={"messages": []}).status_code == 422


def test_batch_rejects_blank_messages(client: TestClient) -> None:
    assert client.post(
        "/api/predict/batch", json={"messages": ["   ", ""]}
    ).status_code == 422


def test_batch_csv_upload(client: TestClient, model_available: bool) -> None:
    if not model_available:
        pytest.skip("no model bundle available")
    csv_bytes = io.BytesIO(
        b"id,message\n1,We need water urgently\n2,Building collapsed with people inside\n3,x\n"
    )
    response = client.post(
        "/api/predict/batch-csv",
        files={"file": ("inbox.csv", csv_bytes, "text/csv")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == 2
    assert body["skipped"] == 1


def test_batch_csv_single_column_without_header(
    client: TestClient, model_available: bool
) -> None:
    if not model_available:
        pytest.skip("no model bundle available")
    csv_bytes = io.BytesIO(b"We need medical help at the clinic\nFlood water is rising\n")
    body = client.post(
        "/api/predict/batch-csv", files={"file": ("plain.csv", csv_bytes, "text/csv")}
    ).json()
    assert body["count"] == 2


def test_batch_csv_without_text_column_is_rejected(client: TestClient) -> None:
    csv_bytes = io.BytesIO(b"id,value\n1,2\n")
    response = client.post(
        "/api/predict/batch-csv", files={"file": ("bad.csv", csv_bytes, "text/csv")}
    )
    assert response.status_code == 400
    assert "text column" in response.json()["detail"]


def test_batch_csv_empty_file_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/predict/batch-csv", files={"file": ("empty.csv", io.BytesIO(b""), "text/csv")}
    )
    assert response.status_code == 400


# ── recommendations ──────────────────────────────────────────────────────────


def test_recommend_from_message(client: TestClient, model_available: bool) -> None:
    if not model_available:
        pytest.skip("no model bundle available")
    body = client.post("/api/recommend", json={"message": URGENT_MESSAGE}).json()
    assert body["actions"] and body["immediate_count"] >= 1
    assert body["severity_level"] in {"high", "critical"}


def test_recommend_from_probabilities(client: TestClient) -> None:
    body = client.post(
        "/api/recommend",
        json={
            "probabilities": {"water": 0.9, "food": 0.8},
            "severity_score": 62.0,
            "severity_level": "high",
            "event": "Pakistan floods",
        },
    ).json()
    categories = {a["category"] for a in body["actions"]}
    assert {"water", "food"} & categories


def test_recommend_requires_input(client: TestClient) -> None:
    assert client.post("/api/recommend", json={}).status_code == 422


def test_rules_endpoint(client: TestClient) -> None:
    body = client.get("/api/recommend/rules").json()
    assert body["rule_count"] > 20
    assert body["agencies"]
    assert all({"id", "action", "category"} <= set(r) for r in body["rules"])


# ── model ────────────────────────────────────────────────────────────────────


def test_model_info_and_performance(client: TestClient, model_available: bool) -> None:
    if not model_available:
        pytest.skip("no model bundle available")
    info = client.get("/api/model/info").json()
    assert info["categories"] == 35
    assert info["split"]["train"] > info["split"]["test"]

    performance = client.get("/api/model/performance").json()
    assert performance["macro_f1"] > 0.405, "must beat the documented baseline"
    assert len(performance["per_label"]) == 35
    assert performance["comparison"], "the candidate comparison must be persisted"
    labels = [row["category"] for row in performance["per_label"]]
    assert len(set(labels)) == len(labels)


def test_model_curves(client: TestClient, model_available: bool) -> None:
    if not model_available:
        pytest.skip("no model bundle available")
    body = client.get("/api/model/curves/water").json()
    assert body["available"] is True
    assert body["pr_curve"]["pr_auc"] > 0
    assert body["f1_by_threshold"]


def test_model_curves_unknown_category(client: TestClient, model_available: bool) -> None:
    if not model_available:
        pytest.skip("no model bundle available")
    assert client.get("/api/model/curves/nope").status_code == 404


def test_model_global_terms(client: TestClient, model_available: bool) -> None:
    if not model_available:
        pytest.skip("no model bundle available")
    body = client.get("/api/model/global-terms/water?limit=8").json()
    assert body["category"] == "water"
    assert len(body["terms"]) <= 8
    assert client.get("/api/model/global-terms/nope").status_code == 404


def test_model_categories_expose_thresholds(
    client: TestClient, model_available: bool
) -> None:
    if not model_available:
        pytest.skip("no model bundle available")
    rows = client.get("/api/model/categories").json()["categories"]
    assert len(rows) == 35
    assert all(0 < row["threshold"] < 1 for row in rows)


# ── hazards ──────────────────────────────────────────────────────────────────


def test_hazards_endpoint_degrades_gracefully(client: TestClient) -> None:
    """Offline or rate-limited feeds must still produce a 200 with statuses."""
    body = client.get("/api/hazards").json()
    assert {"hazards", "sources", "online"} <= set(body)
    assert len(body["sources"]) == 3
    for source in body["sources"]:
        assert source["status"] in {"ok", "unavailable", "disabled"}
    for hazard in body["hazards"][:5]:
        assert hazard["source"] in {"usgs", "eonet", "gdacs"}


def test_hazards_india_filter(client: TestClient) -> None:
    body = client.get("/api/hazards?india_only=true").json()
    assert all(h["in_india"] for h in body["hazards"])


# ── docs ─────────────────────────────────────────────────────────────────────


def test_openapi_documents_every_router(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]
    for expected in (
        "/api/predict", "/api/predict/batch", "/api/recommend",
        "/api/analytics/summary-stats", "/api/model/performance", "/api/hazards",
    ):
        assert expected in paths
