"""Model transparency endpoints: metrics, per-label curves, global terms."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend import schemas
from backend.state import state

router = APIRouter(prefix="/api/model", tags=["model"])


@router.get("/info")
def model_info() -> dict[str, Any]:
    """Which model is serving, when it was trained, and with which versions."""
    return state.require_model().info


@router.get("/performance", response_model=schemas.ModelPerformance)
def performance() -> dict[str, Any]:
    """Per-label test metrics and the candidate comparison table."""
    return state.require_model().performance()


@router.get("/curves/{category}", response_model=schemas.LabelCurves)
def curves(category: str) -> dict[str, Any]:
    """Precision-recall curve and F1-vs-threshold for one label."""
    model = state.require_model()
    try:
        return model.label_curves(category)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown category {category!r}")


@router.get("/global-terms/{category}", response_model=schemas.GlobalTerms)
def global_terms(category: str, limit: int = Query(15, ge=1, le=50)) -> dict[str, Any]:
    """Highest-weight features for a category, from the linear explainer."""
    model = state.require_model()
    if category not in model.categories:
        raise HTTPException(status_code=404, detail=f"unknown category {category!r}")
    return {"category": category, "terms": model.global_terms(category, limit)}


@router.get("/categories")
def categories() -> dict[str, Any]:
    """All served categories with their tuned thresholds."""
    model = state.require_model()
    return {
        "categories": [
            {"category": c, "threshold": round(float(t), 2)}
            for c, t in zip(model.categories, model.thresholds)
        ]
    }
