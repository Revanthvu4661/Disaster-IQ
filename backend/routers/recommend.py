"""Recommendation endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from backend import schemas
from backend.services.recommend import recommend
from backend.services.severity import compute_severity, severity_level
from backend.state import state

router = APIRouter(prefix="/api", tags=["recommendation"])


@router.post("/recommend", response_model=schemas.RecommendationPlan)
def recommend_actions(body: schemas.RecommendRequest) -> dict[str, Any]:
    """Build a prioritised action plan.

    Accepts either a raw ``message`` (which is classified first) or an explicit
    ``probabilities`` map from a previous prediction.
    """
    rules = state.require_rules()

    if body.probabilities:
        probabilities = {k: float(v) for k, v in body.probabilities.items()}
        if body.severity_score is not None:
            severity = {
                "score": body.severity_score,
                "level": body.severity_level or severity_level(body.severity_score),
            }
        else:
            model = state.require_model()
            ordered = [probabilities.get(c, 0.0) for c in model.categories]
            severity = compute_severity(ordered, model.categories)
        triggered = body.triggered or [k for k, v in probabilities.items() if v >= 0.5]
        event = body.event
    elif body.message:
        model = state.require_model()
        result = model.classify(body.message, explain=False)
        probabilities = result.probabilities
        severity = result.severity
        triggered = result.triggered_names
        event = body.event or result.event
    else:
        raise HTTPException(
            status_code=422, detail="provide either 'message' or 'probabilities'"
        )

    return recommend(
        probabilities=probabilities,
        severity=severity,
        event=event,
        triggered=triggered,
        ruleset=rules,
    )


@router.get("/recommend/rules", tags=["recommendation"])
def rules_summary() -> dict[str, Any]:
    """Describe the loaded rule set, so the UI can show what drives the plan."""
    rules = state.require_rules()
    return {
        **rules.summary(),
        "rules": [
            {
                "id": r.get("id"),
                "category": r.get("category"),
                "agency": rules.agency_label(r.get("agency", "coordination")),
                "urgency": r.get("urgency"),
                "weight": r.get("weight"),
                "min_probability": r.get("min_probability"),
                "action": r.get("action"),
                "resources": r.get("resources", []),
                "rationale": r.get("rationale"),
            }
            for r in rules.rules
        ],
        "event_overlays": [
            {
                "event": o.get("event"),
                "action": o.get("action"),
                "urgency": o.get("urgency"),
                "when_categories": o.get("when_categories", []),
                "resources": o.get("resources", []),
            }
            for o in rules.event_overlays
        ],
    }
