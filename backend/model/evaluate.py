"""Evaluation helpers shared by training and the model-performance endpoints.

Key ideas:

* thresholds are tuned per label on the **validation** split only;
* every reported metric comes from the untouched **test** split;
* metrics are returned as plain dicts so they can be persisted in the model
  bundle and served by the API without recomputation.
"""

from __future__ import annotations

from typing import Sequence

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    f1_score,
    precision_recall_curve,
    precision_recall_fscore_support,
)

DEFAULT_THRESHOLD = 0.5
THRESHOLD_GRID = np.round(np.arange(0.05, 0.96, 0.01), 2)


def tune_thresholds(
    y_true: np.ndarray,
    proba: np.ndarray,
    grid: Sequence[float] = THRESHOLD_GRID,
    min_positives: int = 5,
) -> list[float]:
    """Per-label threshold that maximises F1 on the given (validation) split.

    Labels with fewer than ``min_positives`` positives keep the default
    threshold, because a tuned value would be fitted to noise.
    """
    n_labels = y_true.shape[1]
    thresholds: list[float] = []
    for j in range(n_labels):
        col = y_true[:, j]
        if col.sum() < min_positives:
            thresholds.append(DEFAULT_THRESHOLD)
            continue
        best_t, best_f1 = DEFAULT_THRESHOLD, -1.0
        for t in grid:
            f1 = f1_score(col, (proba[:, j] >= t).astype(int), zero_division=0)
            if f1 > best_f1:
                best_t, best_f1 = float(t), float(f1)
        thresholds.append(best_t)
    return thresholds


def apply_thresholds(proba: np.ndarray, thresholds: Sequence[float]) -> np.ndarray:
    """Binarise a probability matrix with one threshold per label."""
    return (proba >= np.asarray(thresholds, dtype=float)[None, :]).astype(int)


def per_label_metrics(
    y_true: np.ndarray,
    proba: np.ndarray,
    thresholds: Sequence[float],
    label_names: Sequence[str],
) -> list[dict]:
    """Precision / recall / F1 / support / PR-AUC per label."""
    y_pred = apply_thresholds(proba, thresholds)
    prec, rec, f1, sup = precision_recall_fscore_support(
        y_true, y_pred, average=None, zero_division=0, labels=range(len(label_names))
    )
    rows: list[dict] = []
    for j, name in enumerate(label_names):
        col = y_true[:, j]
        pr_auc = (
            float(average_precision_score(col, proba[:, j]))
            if 0 < col.sum() < len(col)
            else 0.0
        )
        rows.append(
            {
                "category": name,
                "precision": round(float(prec[j]), 4),
                "recall": round(float(rec[j]), 4),
                "f1": round(float(f1[j]), 4),
                "support": int(sup[j]),
                "pr_auc": round(pr_auc, 4),
                "threshold": round(float(thresholds[j]), 2),
            }
        )
    return rows


def aggregate_metrics(
    y_true: np.ndarray,
    proba: np.ndarray,
    thresholds: Sequence[float],
    label_names: Sequence[str],
) -> dict:
    """Macro / micro / weighted F1, PR-AUC and per-label rows."""
    y_pred = apply_thresholds(proba, thresholds)
    rows = per_label_metrics(y_true, proba, thresholds, label_names)
    valid = [r for r in rows if r["support"] > 0]
    return {
        "macro_f1": round(float(f1_score(y_true, y_pred, average="macro", zero_division=0)), 4),
        "micro_f1": round(float(f1_score(y_true, y_pred, average="micro", zero_division=0)), 4),
        "weighted_f1": round(
            float(f1_score(y_true, y_pred, average="weighted", zero_division=0)), 4
        ),
        "samples_f1": round(
            float(f1_score(y_true, y_pred, average="samples", zero_division=0)), 4
        ),
        "macro_pr_auc": round(float(np.mean([r["pr_auc"] for r in valid])), 4) if valid else 0.0,
        "exact_match": round(float(np.mean((y_pred == y_true).all(axis=1))), 4),
        "hamming_accuracy": round(float(np.mean(y_pred == y_true)), 4),
        "per_label": rows,
    }


def pr_curve(y_true_col: np.ndarray, proba_col: np.ndarray, max_points: int = 120) -> dict:
    """Downsampled precision-recall curve for one label, for the UI."""
    if y_true_col.sum() == 0:
        return {"precision": [], "recall": [], "thresholds": [], "pr_auc": 0.0}
    precision, recall, thresholds = precision_recall_curve(y_true_col, proba_col)
    idx = np.linspace(0, len(thresholds) - 1, min(max_points, len(thresholds))).astype(int)
    return {
        "precision": [round(float(precision[i]), 4) for i in idx],
        "recall": [round(float(recall[i]), 4) for i in idx],
        "thresholds": [round(float(thresholds[i]), 4) for i in idx],
        "pr_auc": round(float(average_precision_score(y_true_col, proba_col)), 4),
    }


def f1_vs_threshold(y_true_col: np.ndarray, proba_col: np.ndarray) -> list[dict]:
    """F1 as a function of threshold, so the UI can show the tuning trade-off."""
    if y_true_col.sum() == 0:
        return []
    out = []
    for t in np.round(np.arange(0.05, 0.96, 0.05), 2):
        out.append(
            {
                "threshold": float(t),
                "f1": round(
                    float(f1_score(y_true_col, (proba_col >= t).astype(int), zero_division=0)), 4
                ),
            }
        )
    return out
