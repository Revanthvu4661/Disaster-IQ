"""Earthquake and cyclone hazard index (Level 2) and the recommendation engine (Level 3).

Runs on the committed CSVs in ``backend/data/clean/hazard/``; no network.
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from backend.hazard_pipeline import INDIA_POPULATION_2011, Region, haversine_km
from backend.services import recommendations as rec
from backend.services.hazard_risk import TESTS, annual_probability, level_of, load_hazard_risk


@pytest.fixture(scope="module")
def hazard():
    return load_hazard_risk()


# ── hazard index ─────────────────────────────────────────────────────────────


def test_populations_sum_to_the_2011_census(hazard) -> None:
    assert int(hazard.regions["population"].sum()) == INDIA_POPULATION_2011
    assert len(hazard.regions) == 36


def test_probability_and_level_arithmetic() -> None:
    assert annual_probability(0, 76) == 0
    assert annual_probability(76, 76) == pytest.approx(1 - math.exp(-1))
    thresholds = {"critical": 0.4, "high": 0.15, "medium": 0.05}
    assert [level_of(p, thresholds) for p in (0.5, 0.4, 0.2, 0.05, 0.049)] == [
        "critical", "critical", "high", "medium", "low"]


def test_region_distance_is_zero_inside_and_grows_outside() -> None:
    import shapely

    square = Region("box", shapely.geometry.box(70, 10, 72, 12))
    d = square.distance_km([11, 11, 11], [71, 73, 75])
    assert d[0] == 0
    assert 100 < d[1] < 130          # 1 degree of longitude at 11°N is about 109 km
    assert d[2] > d[1]
    assert haversine_km(0, 0, 0, 1) == pytest.approx(111.2, abs=0.5)


@pytest.mark.parametrize("kind", list(TESTS))
def test_levels_come_from_the_highest_test(hazard, kind: str) -> None:
    order = ["low", "medium", "high", "critical"]
    for row in hazard.payloads[kind]["regions"]:
        assert row["level"] == max((t["level"] for t in row["tests"]), key=order.index)
        assert row["probability"] == max(t["probability"] for t in row["tests"] if t["level"] == row["level"])


def test_regional_sanity(hazard) -> None:
    eq = {r["region"]: r for r in hazard.payloads["earthquake"]["regions"]}
    assert eq["Assam"]["level"] == "critical" and eq["Kerala"]["level"] == "low"
    assert eq["Gujarat"]["level"] == "medium"        # one M7+ (Bhuj, 2001) is enough
    cy = {r["region"]: r for r in hazard.payloads["cyclone"]["regions"]}
    assert cy["Odisha"]["level"] == "critical" and cy["Rajasthan"]["level"] == "low"
    assert cy["Ladakh"]["level"] == "low" and cy["Ladakh"]["storms_ts"] == 0


def test_known_events_are_in_the_catalogues(hazard) -> None:
    for kind in TESTS:
        checks = hazard.payloads[kind]["checks"]
        assert checks and all(c["found"] for c in checks), [c for c in checks if not c["found"]]


def test_methodology_says_it_is_not_a_trained_model(hazard) -> None:
    for kind in TESTS:
        method = hazard.payloads[kind]["methodology"]
        assert method["is_trained_model"] is False and "not a trained" in method["statement"]


# ── recommendations ──────────────────────────────────────────────────────────


def _prediction(level: str, population: int = 1_000_000, **extra) -> dict:
    return {"region": f"R-{level}", "level": level, "probability": 0.5, "population": population,
            "low_lying_pct": 20.0, "events_m6": 12, "events_m7": 1, "storms_ts": 20, "storms_hurricane": 6,
            "tests": [{"probability": 0.5}], "summary": "test", **extra}


def _predictions(rows: list[dict]) -> dict:
    return {"scenario": "t", "kind": "index", "window_start": "x", "as_of": "y", "districts": rows}


HOMELESS = {"value": 0.04}


def test_response_formulas_per_hazard() -> None:
    row = _prediction("high")
    flood = rec.recommend("flood", _predictions([row]), HOMELESS, days=7)["regions"][0]["resources"]
    people = 1_000_000 * rec.EXPOSURE["flood"]["high"]
    assert flood["people"] == people
    assert flood["rescue_boats"] == math.ceil(people * 0.20 / 200)
    assert flood["food_rations"] == people * 7 and flood["water_litres"] == people * 15 * 7
    assert flood["long_stay_places"] == round(people * 0.04)
    quake = rec.recommend("earthquake", _predictions([row]), HOMELESS)["regions"][0]["resources"]
    assert quake["rescue_teams"] == math.ceil(quake["people"] / 5000) and "rescue_boats" not in quake
    cyclone = rec.recommend("cyclone", _predictions([row]), HOMELESS)["regions"][0]["resources"]
    assert cyclone["cyclone_shelters"] == math.ceil(cyclone["people"] / 1000)


def test_a_district_without_a_census_population_is_unavailable_not_estimated() -> None:
    """Districts created after 2011 have no census row: every population-based line is None, and left out of totals."""
    newer = _prediction("high", None, region="New district")
    older = _prediction("high", 1_000_000, region="Old district")
    out = rec.recommend("flood", _predictions([newer, older]), HOMELESS, days=7)
    by = {r["region"]: r for r in out["regions"]}
    assert by["New district"]["population"] is None
    assert set(by["New district"]["resources"].values()) == {None}
    assert "unavailable" in by["New district"]["reasoning"]
    assert by["Old district"]["resources"]["people"] == 1_000_000 * rec.EXPOSURE["flood"]["high"]
    assert out["regions_without_population"] == 1
    assert out["totals"]["people"] == by["Old district"]["resources"]["people"]
    assert any("Census 2011" in item["metric"] for item in out["not_included"])
    # The preparedness actions do not need a population, so they still fire from the risk level.
    assert by["New district"]["actions"]


def test_each_district_uses_its_own_population() -> None:
    rows = [_prediction("high", 500_000, region="A"), _prediction("high", 2_000_000, region="B")]
    out = {r["region"]: r for r in rec.recommend("flood", _predictions(rows), HOMELESS)["regions"]}
    assert out["B"]["resources"]["people"] == 4 * out["A"]["resources"]["people"]


def test_priority_order_is_level_then_people() -> None:
    rows = [_prediction("medium", 4_000_000, region="Big medium"),
            _prediction("critical", 500_000, region="Small critical"),
            _prediction("high", 900_000, region="Small high"),
            _prediction("high", 3_000_000, region="Big high"),
            _prediction("low", 5_000_000, region="Low")]
    out = rec.recommend("cyclone", _predictions(rows), HOMELESS)
    assert [r["region"] for r in out["regions"]] == ["Small critical", "Big high", "Small high", "Big medium", "Low"]
    assert out["regions"][-1]["resources"]["people"] == 0
    with pytest.raises(ValueError):
        rec.recommend("cyclone", _predictions(rows), HOMELESS, days=0)
    with pytest.raises(ValueError):
        rec.recommend("tsunami", _predictions(rows), HOMELESS)


def test_preparedness_rules_fire_by_level_and_carry_a_reason() -> None:
    low = rec.preparedness("earthquake", _prediction("low"))
    medium = rec.preparedness("earthquake", _prediction("medium"))
    high = rec.preparedness("earthquake", _prediction("high"))
    assert low == [] and 0 < len(medium) < len(high)
    assert {a["id"] for a in high} >= {"eq-audit", "eq-sar"} and "eq-audit" not in {a["id"] for a in medium}
    assert all(a["why"] and a["basis"] for a in high)
    # An M7+ trigger: no M7+ events, no large-earthquake action.
    assert "eq-large" not in {a["id"] for a in rec.preparedness("earthquake", _prediction("high", events_m7=0))}


def test_hazard_specific_actions() -> None:
    cyclone = {a["id"] for a in rec.preparedness("cyclone", _prediction("critical"))}
    assert {"cy-shelters", "cy-routes", "cy-stock"} <= cyclone
    inland = {a["id"] for a in rec.preparedness("flood", _prediction("high", low_lying_pct=0.0))}
    assert "fl-boats" not in inland and "fl-drains" in inland


def test_homeless_share_comes_from_level_1(history) -> None:
    share = rec.homeless_share(history.records)
    assert 0 < share["value"] < 0.2 and share["records"] > 10


# ── endpoints ────────────────────────────────────────────────────────────────


def test_hazard_risk_endpoints(client: TestClient) -> None:
    for kind in ("earthquake", "cyclone"):
        body = client.get(f"/api/hazard-risk/{kind}").json()
        assert len(body["regions"]) == 36 and body["methodology"]["is_trained_model"] is False
    assert client.get("/api/hazard-risk/flood").status_code == 404


def test_recommendation_endpoints(client: TestClient) -> None:
    for kind in ("earthquake", "flood", "cyclone"):
        body = client.get(f"/api/recommendations/{kind}", params={"days": 3}).json()
        assert body["type"] == kind and body["days"] == 3
        assert [r["rank"] for r in body["regions"]] == list(range(1, len(body["regions"]) + 1))
        assert body["rules"] and body["formula"] and body["parameters"]
    quake = client.get("/api/recommendations/earthquake").json()
    assert quake["regions"][0]["actions"], "the top-ranked region should have preparedness actions"
    assert client.get("/api/recommendations/flood", params={"scenario": "2018-08"}).json()["kind"] == "backtest"
    assert client.get("/api/recommendations/earthquake", params={"scenario": "2018-08"}).status_code == 400
    assert client.get("/api/recommendations/tsunami").status_code == 404
    assert client.get("/api/recommendations/flood", params={"days": 99}).status_code == 422
