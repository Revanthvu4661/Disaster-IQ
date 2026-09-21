"""Rule-driven recommendation engine.

Turns a prediction (categories + probabilities + severity + event) into a
prioritised action plan. All domain knowledge lives in
``data/recommendation_rules.yaml`` so the output is explainable and editable
without code changes.

Priority score for a rule:

    priority = rule_weight * probability * urgency_multiplier * severity_multiplier

Actions are returned sorted by urgency first, then priority, which is how a
duty officer would read them.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import yaml

from backend.config import get_settings
from backend.services.severity import LEVEL_ORDER

logger = logging.getLogger(__name__)

URGENCY_MULTIPLIER = {"immediate": 1.0, "within_6h": 0.8, "within_24h": 0.6}
SEVERITY_MULTIPLIER = {"low": 0.7, "medium": 0.85, "high": 1.0, "critical": 1.15}
URGENCY_LABEL = {
    "immediate": "Immediate",
    "within_6h": "Within 6 hours",
    "within_24h": "Within 24 hours",
}


class RuleSet:
    """Parsed rule file with lookup helpers."""

    def __init__(self, raw: Mapping[str, Any]):
        self.version: int = int(raw.get("version", 1))
        self.agencies: dict[str, str] = dict(raw.get("agencies", {}))
        self.rules: list[dict] = list(raw.get("rules", []))
        self.escalations: list[dict] = list(raw.get("escalations", []))
        self.event_overlays: list[dict] = list(raw.get("event_overlays", []))
        self.resource_units: dict[str, str] = dict(raw.get("resource_units", {}))
        self._by_category: dict[str, list[dict]] = defaultdict(list)
        for rule in self.rules:
            self._by_category[rule["category"]].append(rule)

    def for_category(self, category: str) -> list[dict]:
        return self._by_category.get(category, [])

    def agency_label(self, key: str) -> str:
        return self.agencies.get(key, key.replace("_", " ").title())

    def summary(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "rule_count": len(self.rules),
            "escalation_count": len(self.escalations),
            "overlay_count": len(self.event_overlays),
            "agencies": self.agencies,
            "categories_covered": sorted(self._by_category),
        }


def load_rules(path: Path | None = None) -> RuleSet:
    """Load and parse the rule file (uncached)."""
    target = Path(path or get_settings().rules_path)
    with target.open("r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    ruleset = RuleSet(raw)
    logger.info("Recommender: loaded %d rules from %s", len(ruleset.rules), target)
    return ruleset


@lru_cache(maxsize=1)
def get_rules() -> RuleSet:
    """Cached rule set used by the API."""
    return load_rules()


def _severity_ok(rule: Mapping[str, Any], level: str) -> bool:
    idx = LEVEL_ORDER.index(level) if level in LEVEL_ORDER else 0
    min_level = rule.get("severity_min")
    max_level = rule.get("severity_max")
    if min_level and idx < LEVEL_ORDER.index(min_level):
        return False
    if max_level and idx > LEVEL_ORDER.index(max_level):
        return False
    return True


def _action(
    rule: Mapping[str, Any],
    ruleset: RuleSet,
    *,
    source: str,
    category: str | None,
    probability: float | None,
    priority: float,
) -> dict[str, Any]:
    return {
        "id": rule.get("id", "rule"),
        "action": rule["action"],
        "agency": ruleset.agency_label(rule.get("agency", "coordination")),
        "agency_key": rule.get("agency", "coordination"),
        "resources": list(rule.get("resources", [])),
        "urgency": rule.get("urgency", "within_24h"),
        "urgency_label": URGENCY_LABEL.get(rule.get("urgency", "within_24h"), "Scheduled"),
        "rationale": rule["rationale"],
        "category": category,
        "probability": round(float(probability), 4) if probability is not None else None,
        "priority": round(float(priority), 4),
        "source": source,
    }


def recommend(
    probabilities: Mapping[str, float],
    severity: Mapping[str, Any],
    event: str | None = None,
    triggered: Iterable[str] | None = None,
    ruleset: RuleSet | None = None,
    limit: int = 12,
) -> dict[str, Any]:
    """Build a prioritised action plan for one message.

    Args:
        probabilities: category -> probability.
        severity: the dict returned by :func:`services.severity.compute_severity`.
        event: inferred disaster event, used for overlay rules.
        triggered: categories that passed their tuned threshold. A triggered
            category fires its rule even if the probability floor is not met,
            because the tuned threshold is the better decision boundary.
        limit: maximum number of actions returned.
    """
    rules = ruleset or get_rules()
    level = str(severity.get("level", "low"))
    sev_mult = SEVERITY_MULTIPLIER.get(level, 1.0)
    triggered_set = set(triggered or [])

    actions: list[dict[str, Any]] = []
    fired_categories: list[str] = []

    for category, probability in probabilities.items():
        for rule in rules.for_category(category):
            floor = float(rule.get("min_probability", 0.5))
            by_label = bool(rule.get("trigger_on_label", True)) and category in triggered_set
            if probability < floor and not by_label:
                continue
            if not _severity_ok(rule, level):
                continue
            events = rule.get("events")
            if events and event not in events:
                continue
            priority = (
                float(rule.get("weight", 0.5))
                * float(probability)
                * URGENCY_MULTIPLIER.get(rule.get("urgency", "within_24h"), 0.6)
                * sev_mult
            )
            actions.append(
                _action(
                    rule, rules, source="category",
                    category=category, probability=probability, priority=priority,
                )
            )
            fired_categories.append(category)

    # Severity escalations.
    for rule in rules.escalations:
        if not _severity_ok(rule, level):
            continue
        if rule.get("id") == "verify_low" and actions:
            continue  # a concrete need was found; do not tell the operator to wait
        actions.append(
            _action(
                rule, rules, source="severity",
                category=None, probability=None,
                priority=1.2 * URGENCY_MULTIPLIER.get(rule.get("urgency", "within_24h"), 0.6),
            )
        )

    # Event overlays.
    for overlay in rules.event_overlays:
        if event != overlay.get("event"):
            continue
        wanted = set(overlay.get("when_categories", []))
        if wanted and not (wanted & set(fired_categories)):
            continue
        best = max((probabilities.get(c, 0.0) for c in wanted), default=0.0)
        actions.append(
            _action(
                overlay, rules, source="event",
                category=None, probability=best,
                priority=0.9 * best * sev_mult
                + URGENCY_MULTIPLIER.get(overlay.get("urgency", "within_24h"), 0.6),
            )
        )

    # Deduplicate by action text, keeping the highest priority instance.
    unique: dict[str, dict[str, Any]] = {}
    for action in actions:
        existing = unique.get(action["action"])
        if existing is None or action["priority"] > existing["priority"]:
            unique[action["action"]] = action

    ordered = sorted(
        unique.values(),
        key=lambda a: (URGENCY_MULTIPLIER.get(a["urgency"], 0) * -1, -a["priority"]),
    )[:limit]

    resources: dict[str, float] = defaultdict(float)
    for action in ordered:
        for resource in action["resources"]:
            resources[resource] += action["priority"]

    return {
        "actions": ordered,
        "severity_level": level,
        "severity_score": severity.get("score", 0.0),
        "event": event,
        "agencies": sorted({a["agency"] for a in ordered}),
        "immediate_count": sum(1 for a in ordered if a["urgency"] == "immediate"),
        "resource_priorities": [
            {"resource": r, "score": round(s, 3)}
            for r, s in sorted(resources.items(), key=lambda kv: -kv[1])
        ][:10],
        "rules_version": rules.version,
    }


def forecast_resource_demand(
    plans: Sequence[Mapping[str, Any]],
    predictions: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Aggregate a batch of plans into a ranked resource-demand summary.

    Args:
        plans: recommendation payloads, one per message.
        predictions: optional per-message prediction payloads, used to count how
            many messages requested each need category.
    """
    resource_scores: dict[str, float] = defaultdict(float)
    resource_requests: dict[str, int] = defaultdict(int)
    agency_load: dict[str, int] = defaultdict(int)
    urgency_counts: dict[str, int] = defaultdict(int)

    for plan in plans:
        for action in plan.get("actions", []):
            agency_load[action["agency"]] += 1
            urgency_counts[action["urgency"]] += 1
            for resource in action["resources"]:
                resource_scores[resource] += action["priority"]
                resource_requests[resource] += 1

    category_counts: dict[str, int] = defaultdict(int)
    if predictions:
        for pred in predictions:
            for name in pred.get("triggered_categories", []):
                category_counts[name] += 1

    return {
        "messages": len(plans),
        "resources": [
            {
                "resource": resource,
                "requests": resource_requests[resource],
                "priority_score": round(score, 3),
            }
            for resource, score in sorted(resource_scores.items(), key=lambda kv: -kv[1])
        ][:20],
        "agencies": [
            {"agency": agency, "actions": count}
            for agency, count in sorted(agency_load.items(), key=lambda kv: -kv[1])
        ],
        "urgency": [
            {"urgency": u, "label": URGENCY_LABEL.get(u, u), "count": urgency_counts.get(u, 0)}
            for u in ("immediate", "within_6h", "within_24h")
        ],
        "needs": [
            {"category": c, "messages": n}
            for c, n in sorted(category_counts.items(), key=lambda kv: -kv[1])
        ][:15],
    }
