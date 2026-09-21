"""Severity scoring: noisy-OR behaviour and level thresholds."""

from __future__ import annotations

import numpy as np
import pytest

from backend.services.severity import (
    SEVERITY_WEIGHTS,
    compute_severity,
    severity_level,
)

CATEGORIES = [
    "related", "request", "search_and_rescue", "medical_help", "death",
    "missing_people", "fire", "medical_products", "water", "food", "shelter",
    "floods", "earthquake", "storm", "offer",
]


def proba(**values: float) -> np.ndarray:
    """Build a probability vector over CATEGORIES from keyword arguments."""
    row = np.zeros(len(CATEGORIES))
    for name, value in values.items():
        row[CATEGORIES.index(name)] = value
    return row


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (100.0, "critical"), (70.0, "critical"), (69.9, "high"),
        (45.0, "high"), (44.9, "medium"), (20.0, "medium"),
        (19.9, "low"), (0.0, "low"),
    ],
)
def test_level_boundaries(score: float, expected: str) -> None:
    assert severity_level(score) == expected


def test_single_strong_signal_is_not_diluted() -> None:
    """One confident search-and-rescue signal must not score "low"."""
    result = compute_severity(proba(search_and_rescue=0.9), CATEGORIES)
    assert result["score"] == pytest.approx(90.0, abs=0.1)
    assert result["level"] == "critical"


def test_average_would_have_been_low() -> None:
    """Regression guard: the old mean-based score for this vector was ~7."""
    row = proba(search_and_rescue=0.9)
    weighted = [row[CATEGORIES.index(c)] for c in SEVERITY_WEIGHTS if c in CATEGORIES]
    assert np.mean(weighted) * 100 < 20  # what the old implementation returned
    assert compute_severity(row, CATEGORIES)["score"] > 70


def test_weak_signals_combine() -> None:
    """Several moderate needs together should reach at least 'high'."""
    result = compute_severity(proba(water=0.5, food=0.5, shelter=0.5), CATEGORIES)
    assert 45 <= result["score"] < 100
    assert result["level"] in {"high", "critical"}


def test_no_urgent_categories_scores_zero() -> None:
    result = compute_severity(proba(related=1.0, request=1.0, offer=1.0), CATEGORIES)
    assert result["score"] == 0.0
    assert result["level"] == "low"


def test_weights_are_respected() -> None:
    """A 1.0-weight category must outscore a 0.5-weight one at equal probability."""
    sar = compute_severity(proba(search_and_rescue=0.6), CATEGORIES)["score"]
    storm = compute_severity(proba(storm=0.6), CATEGORIES)["score"]
    assert sar > storm


def test_contributors_are_sorted_and_capped() -> None:
    row = proba(
        search_and_rescue=0.4, medical_help=0.5, water=0.6, food=0.7,
        shelter=0.3, floods=0.2, earthquake=0.9,
    )
    contributors = compute_severity(row, CATEGORIES)["contributors"]
    assert len(contributors) <= 6
    scores = [c["contribution"] for c in contributors]
    assert scores == sorted(scores, reverse=True)


def test_probabilities_are_clipped() -> None:
    result = compute_severity(proba(water=1.5), CATEGORIES)
    assert result["score"] <= 100.0


def test_length_mismatch_raises() -> None:
    with pytest.raises(ValueError):
        compute_severity(np.zeros(3), CATEGORIES)


def test_offer_outweighing_request_is_damped() -> None:
    """An offer of help must not score like a report of the same need."""
    need = proba(shelter=0.9, food=0.8)
    offer = proba(shelter=0.9, food=0.8)
    offer[CATEGORIES.index("offer")] = 0.9
    offer[CATEGORIES.index("request")] = 0.1
    assert compute_severity(offer, CATEGORIES)["score"] < compute_severity(need, CATEGORIES)["score"]


def test_request_outweighing_offer_is_not_damped() -> None:
    row = proba(shelter=0.9, request=0.9)
    row[CATEGORIES.index("offer")] = 0.1
    plain = proba(shelter=0.9)
    assert compute_severity(row, CATEGORIES)["score"] == compute_severity(plain, CATEGORIES)["score"]
