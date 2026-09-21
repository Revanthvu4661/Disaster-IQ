"""Recommendation engine: rule firing, ordering and the resource forecast."""

from __future__ import annotations

import pytest

from backend.services.recommend import (
    forecast_resource_demand,
    get_rules,
    load_rules,
    recommend,
)


@pytest.fixture(scope="module")
def rules():
    return load_rules()


def plan_for(probabilities, level="high", score=60.0, event=None, triggered=None, rules=None):
    return recommend(
        probabilities=probabilities,
        severity={"level": level, "score": score},
        event=event,
        triggered=triggered or [],
        ruleset=rules or get_rules(),
    )


def test_rules_file_loads(rules) -> None:
    assert rules.rules and rules.escalations and rules.event_overlays
    assert rules.agency_label("sar") == "Search and rescue"


def test_water_request_produces_a_wash_action(rules) -> None:
    plan = plan_for({"water": 0.8}, rules=rules)
    actions = [a for a in plan["actions"] if a["category"] == "water"]
    assert actions, "a water rule should fire"
    assert actions[0]["agency_key"] == "wash"
    assert "purification tablets" in " ".join(actions[0]["resources"]).lower()


def test_below_floor_and_untriggered_does_not_fire(rules) -> None:
    plan = plan_for({"water": 0.05}, level="low", score=5, rules=rules)
    assert not [a for a in plan["actions"] if a["category"] == "water"]


def test_triggered_label_fires_even_below_the_floor(rules) -> None:
    """The tuned threshold is the better boundary than the YAML floor."""
    plan = plan_for({"water": 0.12}, triggered=["water"], rules=rules)
    assert [a for a in plan["actions"] if a["category"] == "water"]


def test_actions_are_ordered_by_urgency_then_priority(rules) -> None:
    plan = plan_for(
        {"search_and_rescue": 0.9, "food": 0.8, "money": 0.7, "medical_help": 0.8},
        level="critical", score=90, rules=rules,
    )
    order = {"immediate": 0, "within_6h": 1, "within_24h": 2}
    ranks = [order[a["urgency"]] for a in plan["actions"]]
    assert ranks == sorted(ranks)
    assert plan["immediate_count"] >= 1


def test_critical_severity_escalates_to_the_commander(rules) -> None:
    plan = plan_for({"death": 0.9}, level="critical", score=95, rules=rules)
    assert any(a["source"] == "severity" for a in plan["actions"])
    assert any("incident commander" in a["action"].lower() for a in plan["actions"])


def test_low_severity_with_no_needs_gets_a_review_queue_action(rules) -> None:
    plan = plan_for({"related": 0.2}, level="low", score=3, rules=rules)
    assert plan["actions"], "even a quiet message should produce one action"
    assert any("batch review" in a["action"].lower() for a in plan["actions"])


def test_low_severity_with_a_need_skips_the_review_queue(rules) -> None:
    plan = plan_for({"water": 0.9}, level="low", score=15, rules=rules)
    assert not any("batch review" in a["action"].lower() for a in plan["actions"])


def test_event_overlay_adds_flood_boats(rules) -> None:
    plan = plan_for(
        {"floods": 0.8, "water": 0.7}, event="Pakistan floods", level="critical",
        score=80, rules=rules,
    )
    overlay = [a for a in plan["actions"] if a["source"] == "event"]
    assert overlay, "the Pakistan floods overlay should fire"
    assert "boats" in " ".join(overlay[0]["resources"]).lower()


def test_event_overlay_requires_a_matching_category(rules) -> None:
    plan = plan_for({"money": 0.9}, event="Pakistan floods", rules=rules)
    assert not [a for a in plan["actions"] if a["source"] == "event"]


def test_other_event_does_not_add_overlays(rules) -> None:
    plan = plan_for({"floods": 0.8}, event="Other", rules=rules)
    assert not [a for a in plan["actions"] if a["source"] == "event"]


def test_actions_are_deduplicated(rules) -> None:
    plan = plan_for(
        {"earthquake": 0.9, "search_and_rescue": 0.9, "buildings": 0.8},
        event="Haiti earthquake", level="critical", score=95, rules=rules,
    )
    texts = [a["action"] for a in plan["actions"]]
    assert len(texts) == len(set(texts))


def test_limit_is_respected(rules) -> None:
    plan = recommend(
        probabilities={c: 0.9 for c in ("water", "food", "shelter", "medical_help",
                                        "search_and_rescue", "death", "fire", "floods")},
        severity={"level": "critical", "score": 99},
        event="Haiti earthquake",
        triggered=[],
        ruleset=rules,
        limit=3,
    )
    assert len(plan["actions"]) == 3


def test_resource_priorities_are_ranked(rules) -> None:
    plan = plan_for({"water": 0.9, "food": 0.8}, rules=rules)
    scores = [r["score"] for r in plan["resource_priorities"]]
    assert scores == sorted(scores, reverse=True)


def test_forecast_aggregates_a_batch(rules) -> None:
    plans = [
        plan_for({"water": 0.9}, rules=rules),
        plan_for({"water": 0.8, "food": 0.7}, rules=rules),
        plan_for({"medical_help": 0.9}, level="critical", score=90, rules=rules),
    ]
    predictions = [
        {"triggered_categories": ["water"]},
        {"triggered_categories": ["water", "food"]},
        {"triggered_categories": ["medical_help"]},
    ]
    forecast = forecast_resource_demand(plans, predictions)
    assert forecast["messages"] == 3
    assert forecast["resources"][0]["requests"] >= 1
    needs = {n["category"]: n["messages"] for n in forecast["needs"]}
    assert needs["water"] == 2
    assert sum(u["count"] for u in forecast["urgency"]) > 0


def test_forecast_handles_empty_input() -> None:
    forecast = forecast_resource_demand([], [])
    assert forecast["messages"] == 0
    assert forecast["resources"] == []
