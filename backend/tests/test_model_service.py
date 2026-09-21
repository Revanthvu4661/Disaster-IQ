"""Model service: bundle validation, thresholds, explanations and metrics."""

from __future__ import annotations

import numpy as np
import pytest

from backend.model.evaluate import (
    aggregate_metrics,
    apply_thresholds,
    f1_vs_threshold,
    pr_curve,
    tune_thresholds,
)
from backend.services import model_service as ms


# ── evaluation helpers ───────────────────────────────────────────────────────


def test_threshold_tuning_finds_the_separating_point() -> None:
    y = np.array([[0], [0], [1], [1]])
    proba = np.array([[0.1], [0.2], [0.8], [0.9]])
    thresholds = tune_thresholds(
        y, proba, grid=np.arange(0.05, 0.96, 0.05), min_positives=1
    )
    assert 0.2 < thresholds[0] <= 0.8


def test_threshold_tuning_keeps_the_default_for_rare_labels() -> None:
    y = np.zeros((20, 1), dtype=int)
    y[0, 0] = 1
    proba = np.random.default_rng(0).random((20, 1))
    assert tune_thresholds(y, proba, min_positives=5)[0] == 0.5


def test_apply_thresholds_is_per_label() -> None:
    proba = np.array([[0.4, 0.4]])
    assert apply_thresholds(proba, [0.3, 0.5]).tolist() == [[1, 0]]


def test_aggregate_metrics_shape() -> None:
    y = np.array([[1, 0], [0, 1], [1, 1], [0, 0]])
    proba = np.array([[0.9, 0.1], [0.2, 0.8], [0.7, 0.6], [0.1, 0.2]])
    metrics = aggregate_metrics(y, proba, [0.5, 0.5], ["a", "b"])
    assert 0 <= metrics["macro_f1"] <= 1
    assert len(metrics["per_label"]) == 2
    assert metrics["per_label"][0]["support"] == 2


def test_curves_handle_an_empty_label() -> None:
    y = np.zeros(10, dtype=int)
    p = np.random.default_rng(1).random(10)
    assert pr_curve(y, p)["pr_auc"] == 0.0
    assert f1_vs_threshold(y, p) == []


# ── bundle validation ────────────────────────────────────────────────────────


def test_version_mismatch_detects_old_schema() -> None:
    assert ms._version_mismatch({"schema_version": 1}) is not None


def test_version_mismatch_detects_sklearn_change() -> None:
    reason = ms._version_mismatch(
        {"schema_version": ms.BUNDLE_SCHEMA_VERSION, "sklearn_version": "0.24.0"}
    )
    assert reason and "scikit-learn" in reason


def test_version_match_passes() -> None:
    import sklearn

    bundle = {
        "schema_version": ms.BUNDLE_SCHEMA_VERSION,
        "sklearn_version": sklearn.__version__,
    }
    assert ms._version_mismatch(bundle) is None


def test_smoke_test_reports_a_broken_predictor() -> None:
    class Broken:
        def predict_proba(self, _x):
            raise RuntimeError("weights missing")

    reason = ms._smoke_test({"predictor": Broken(), "category_names": ["a"]})
    assert reason and "weights missing" in reason


def test_smoke_test_reports_label_mismatch() -> None:
    class Wrong:
        def predict_proba(self, x):
            return np.zeros((len(x), 3))

    assert ms._smoke_test({"predictor": Wrong(), "category_names": ["a"]}) is not None


def test_load_bundle_without_training_raises(tmp_path) -> None:
    with pytest.raises(ms.ModelUnavailable):
        ms.load_bundle(path=tmp_path / "missing.joblib", allow_train=False)


# ── service behaviour against the real bundle ────────────────────────────────


@pytest.fixture(scope="module")
def service() -> ms.ModelService:
    try:
        return ms.ModelService(ms.load_bundle(allow_train=False))
    except ms.ModelUnavailable:
        pytest.skip("no model bundle available")


def test_classify_uses_tuned_thresholds(service: ms.ModelService) -> None:
    result = service.classify("We need clean drinking water for fifty families")
    for entry in result.categories:
        assert entry["triggered"] == (entry["confidence"] >= entry["threshold"])
    assert result.probabilities
    assert set(result.triggered_names) <= set(service.categories)


def test_classify_accepts_a_precomputed_row(service: ms.ModelService) -> None:
    row = np.zeros(len(service.categories))
    row[service.categories.index("water")] = 0.99
    result = service.classify("anything", proba_row=row, explain=False)
    assert "water" in result.triggered_names


def test_highlight_spans_do_not_overlap(service: ms.ModelService) -> None:
    message = "People are trapped under the collapsed building and need water"
    result = service.classify(message)
    spans = service.highlight_spans(message, result.explanations)
    for previous, current in zip(spans, spans[1:]):
        assert previous["end"] <= current["start"]
    for span in spans:
        assert message[span["start"] : span["end"]] == span["text"]


def test_global_terms_are_informative(service: ms.ModelService) -> None:
    terms = [t["term"] for t in service.global_terms("water", 10)]
    assert terms, "the explainer should expose global terms"
    assert "the" not in terms


def test_global_terms_unknown_category(service: ms.ModelService) -> None:
    assert service.global_terms("not_a_category") == []


def test_performance_payload(service: ms.ModelService) -> None:
    performance = service.performance()
    assert performance["macro_f1"] > 0.405
    assert len(performance["per_label"]) == len(service.categories)


def test_label_curves_unknown_category(service: ms.ModelService) -> None:
    with pytest.raises(KeyError):
        service.label_curves("nope")
