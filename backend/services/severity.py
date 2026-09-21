"""Severity scoring for a predicted category probability vector.

The original implementation averaged the probabilities of 13 urgent categories,
which diluted a single strong life-threatening signal into a "low" score. This
module uses a weighted noisy-OR instead:

    score = (1 - Π_c (1 - w_c · p_c)) · 100

so one confident urgent category is enough to escalate, while several weak
signals still combine. Weights encode how life-threatening each category is.
"""

from __future__ import annotations

from typing import Iterable, Mapping, Sequence

import numpy as np

# Category -> weight in [0, 1]. Higher = more life-threatening.
SEVERITY_WEIGHTS: dict[str, float] = {
    "search_and_rescue": 1.0,
    "medical_help": 0.9,
    "death": 0.9,
    "missing_people": 0.8,
    "fire": 0.8,
    "medical_products": 0.7,
    "water": 0.7,
    "food": 0.6,
    "shelter": 0.6,
    "floods": 0.6,
    "earthquake": 0.6,
    "storm": 0.5,
}

# Ordered high -> low; the first matching bound wins.
SEVERITY_LEVELS: tuple[tuple[float, str], ...] = (
    (70.0, "critical"),
    (45.0, "high"),
    (20.0, "medium"),
    (0.0, "low"),
)

LEVEL_ORDER: tuple[str, ...] = ("low", "medium", "high", "critical")


def severity_level(score: float) -> str:
    """Map a 0-100 severity score onto a level label."""
    for bound, level in SEVERITY_LEVELS:
        if score >= bound:
            return level
    return "low"


def compute_severity(
    proba_row: Sequence[float] | np.ndarray,
    category_names: Sequence[str],
    weights: Mapping[str, float] | None = None,
) -> dict:
    """Weighted noisy-OR severity for one probability vector.

    Args:
        proba_row: per-category probabilities, aligned with ``category_names``.
        category_names: category names in the same order as ``proba_row``.
        weights: optional weight override; defaults to ``SEVERITY_WEIGHTS``.

    Returns:
        ``{"score": float, "level": str, "contributors": [...]}`` where
        contributors are the weighted categories sorted by contribution.
    """
    w = dict(SEVERITY_WEIGHTS if weights is None else weights)
    proba = np.asarray(proba_row, dtype=float)
    if proba.ndim != 1:
        raise ValueError("proba_row must be one-dimensional")
    if len(proba) != len(category_names):
        raise ValueError(
            f"proba_row has {len(proba)} values but {len(category_names)} categories"
        )

    complement = 1.0
    contributors: list[dict] = []
    for name, p in zip(category_names, proba):
        weight = w.get(name)
        if weight is None:
            continue
        p = float(min(max(p, 0.0), 1.0))
        effective = weight * p
        complement *= 1.0 - effective
        if p > 0.0:
            contributors.append(
                {
                    "category": name,
                    "probability": round(p, 4),
                    "weight": weight,
                    "contribution": round(effective, 4),
                }
            )

    score = (1.0 - complement) * 100.0
    contributors.sort(key=lambda c: c["contribution"], reverse=True)
    return {
        "score": round(float(score), 1),
        "level": severity_level(score),
        "contributors": contributors[:6],
    }


def weighted_categories() -> Iterable[str]:
    """Categories that participate in the severity score."""
    return SEVERITY_WEIGHTS.keys()
