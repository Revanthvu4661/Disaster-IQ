"""Train, benchmark and persist the DisasterIQ multi-label classifier.

Run:
    python -m backend.model.train_model              # full benchmark
    python -m backend.model.train_model --fast       # skip embedding models
    python -m backend.model.train_model --only tfidf_logreg_wordchar

What it does:

1. loads the cleaned corpus and drops ``related == 2`` noise rows;
2. splits 60 / 20 / 20 train / validation / test with a fixed seed;
3. fits every candidate predictor with class balancing;
4. tunes one threshold per label on the **validation** split;
5. scores every candidate on the untouched **test** split;
6. keeps the best by test macro-F1 and writes the bundle plus
   ``docs/metrics.json`` (used by MODEL_CARD.md and the API).
"""

from __future__ import annotations

import argparse
import json
import logging
import platform
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import joblib
import numpy as np
import sklearn
from sklearn.model_selection import train_test_split

from backend.config import MODEL_DIR, get_settings
from backend.etl import category_columns, load_clean_data, relevant
from backend.model.evaluate import aggregate_metrics, tune_thresholds
from backend.model.predictors import (
    BasePredictor,
    DistilBertPredictor,
    EmbeddingLinearPredictor,
    EnsemblePredictor,
    TfidfLinearPredictor,
    enable_system_certificates,
)

logger = logging.getLogger(__name__)

MODEL_PATH = MODEL_DIR / "disaster_model.joblib"
METRICS_PATH = Path(__file__).resolve().parents[2] / "docs" / "metrics.json"
RANDOM_SEED = 42

#: name -> factory. Order matters only for readability of the report.
CANDIDATES: dict[str, Callable[[], BasePredictor]] = {
    "ensemble_sgd_cnb": lambda: EnsemblePredictor(),
    "tfidf_logreg_wordchar": lambda: TfidfLinearPredictor(kind="logreg", char_ngrams=True),
    "tfidf_logreg_word": lambda: TfidfLinearPredictor(kind="logreg", char_ngrams=False),
    "tfidf_linearsvc_wordchar": lambda: TfidfLinearPredictor(
        kind="linearsvc", char_ngrams=True
    ),
    "minilm_logreg": lambda: EmbeddingLinearPredictor(),
    "distilbert": lambda: DistilBertPredictor(),
}
#: Candidates that download a transformer model; skipped by ``--fast`` and
#: skipped automatically when their dependencies or a GPU are unavailable.
EMBEDDING_CANDIDATES = {"minilm_logreg", "distilbert"}


def load_splits() -> dict[str, Any]:
    """Return train/val/test text and label matrices plus label names."""
    df = relevant(load_clean_data())
    cats = category_columns(df)
    X = df["message"].astype(str).to_numpy()
    Y = df[cats].to_numpy(dtype=np.int8)

    # Constant labels (child_alone is all zeros) cannot be learned or scored.
    keep = np.array([0 < Y[:, j].sum() < len(Y) for j in range(Y.shape[1])])
    dropped = [c for c, k in zip(cats, keep) if not k]
    if dropped:
        logger.info("Dropping constant labels: %s", dropped)
    cats = [c for c, k in zip(cats, keep) if k]
    Y = Y[:, keep]

    X_tmp, X_test, Y_tmp, Y_test = train_test_split(
        X, Y, test_size=0.2, random_state=RANDOM_SEED, shuffle=True
    )
    X_train, X_val, Y_train, Y_val = train_test_split(
        X_tmp, Y_tmp, test_size=0.25, random_state=RANDOM_SEED, shuffle=True
    )
    logger.info(
        "Split sizes: train=%s val=%s test=%s labels=%s",
        len(X_train), len(X_val), len(X_test), len(cats),
    )
    for name, Ys in (("train", Y_train), ("val", Y_val), ("test", Y_test)):
        empty = [c for c, s in zip(cats, Ys.sum(axis=0)) if s == 0]
        if empty:
            logger.warning("Labels with no positives in %s split: %s", name, empty)
    return {
        "X_train": X_train, "Y_train": Y_train,
        "X_val": X_val, "Y_val": Y_val,
        "X_test": X_test, "Y_test": Y_test,
        "categories": cats,
        "n_rows": int(len(X)),
    }


def evaluate_candidate(
    predictor: BasePredictor, splits: dict[str, Any]
) -> dict[str, Any]:
    """Fit, tune thresholds on validation, score on test."""
    t0 = time.time()
    predictor.fit(splits["X_train"], splits["Y_train"])
    fit_seconds = time.time() - t0

    proba_val = predictor.predict_proba(splits["X_val"])
    thresholds = tune_thresholds(splits["Y_val"], proba_val)

    t0 = time.time()
    proba_test = predictor.predict_proba(splits["X_test"])
    predict_seconds = time.time() - t0

    cats = splits["categories"]
    test = aggregate_metrics(splits["Y_test"], proba_test, thresholds, cats)
    default = aggregate_metrics(
        splits["Y_test"], proba_test, [0.5] * len(cats), cats
    )
    val = aggregate_metrics(splits["Y_val"], proba_val, thresholds, cats)
    return {
        "name": predictor.name,
        "thresholds": thresholds,
        "test": test,
        "validation": {k: v for k, v in val.items() if k != "per_label"},
        "test_default_threshold": {
            k: v for k, v in default.items() if k != "per_label"
        },
        "fit_seconds": round(fit_seconds, 1),
        "predict_ms_per_message": round(
            predict_seconds / max(len(splits["X_test"]), 1) * 1000, 3
        ),
        "proba_test": proba_test.astype(np.float32),
        "predictor": predictor,
    }


def train(
    only: list[str] | None = None,
    fast: bool = False,
    save: bool = True,
) -> dict[str, Any]:
    """Run the benchmark and persist the winning bundle."""
    splits = load_splits()
    names = list(CANDIDATES)
    if only:
        names = [n for n in names if n in only]
    if fast:
        names = [n for n in names if n not in EMBEDDING_CANDIDATES]
    if "distilbert" in names and not DistilBertPredictor.is_available():
        logger.info("Skipping distilbert: no CUDA device available")
        names = [n for n in names if n != "distilbert"]
    enable_system_certificates()

    results: list[dict[str, Any]] = []
    for name in names:
        logger.info("── candidate: %s", name)
        try:
            result = evaluate_candidate(CANDIDATES[name](), splits)
        except Exception as exc:  # noqa: BLE001 - a missing optional dep must not abort
            logger.warning("candidate %s failed: %s", name, exc)
            continue
        logger.info(
            "   %s: test macro-F1 %.4f  micro-F1 %.4f  PR-AUC %.4f  (%.0fs fit)",
            name, result["test"]["macro_f1"], result["test"]["micro_f1"],
            result["test"]["macro_pr_auc"], result["fit_seconds"],
        )
        results.append(result)

    if not results:
        raise RuntimeError("no candidate trained successfully")

    results.sort(key=lambda r: r["test"]["macro_f1"], reverse=True)
    best = results[0]
    logger.info("Winner: %s (test macro-F1 %.4f)", best["name"], best["test"]["macro_f1"])

    explainer = best["predictor"] if best["predictor"].supports_explain else None
    if explainer is None:
        for r in results:
            if r["predictor"].supports_explain:
                explainer = r["predictor"]
                logger.info("Using %s as the explanation model", r["name"])
                break

    comparison = [
        {
            "name": r["name"],
            "test_macro_f1": r["test"]["macro_f1"],
            "test_micro_f1": r["test"]["micro_f1"],
            "test_weighted_f1": r["test"]["weighted_f1"],
            "test_macro_pr_auc": r["test"]["macro_pr_auc"],
            "test_exact_match": r["test"]["exact_match"],
            "macro_f1_at_0_5": r["test_default_threshold"]["macro_f1"],
            "validation_macro_f1": r["validation"]["macro_f1"],
            "fit_seconds": r["fit_seconds"],
            "predict_ms_per_message": r["predict_ms_per_message"],
        }
        for r in results
    ]

    bundle: dict[str, Any] = {
        "schema_version": 2,
        "predictor": best["predictor"],
        "explainer": explainer,
        "model_name": best["name"],
        "category_names": splits["categories"],
        "thresholds": best["thresholds"],
        "metrics": best["test"],
        "validation_metrics": best["validation"],
        "metrics_at_default_threshold": best["test_default_threshold"],
        "comparison": comparison,
        "macro_f1": best["test"]["macro_f1"],
        "sklearn_version": sklearn.__version__,
        "python_version": platform.python_version(),
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataset_rows": splits["n_rows"],
        "split": {
            "train": int(len(splits["X_train"])),
            "validation": int(len(splits["X_val"])),
            "test": int(len(splits["X_test"])),
            "seed": RANDOM_SEED,
        },
        # Kept so the API can serve PR curves and threshold sweeps without
        # retraining or shipping the test set separately.
        "test_proba": best["proba_test"],
        "test_labels": splits["Y_test"].astype(np.int8),
    }

    if save:
        MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(bundle, MODEL_PATH, compress=3)
        logger.info("Saved bundle to %s", MODEL_PATH)
        METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)
        METRICS_PATH.write_text(
            json.dumps(
                {
                    "model_name": bundle["model_name"],
                    "trained_at": bundle["trained_at"],
                    "sklearn_version": bundle["sklearn_version"],
                    "split": bundle["split"],
                    "comparison": comparison,
                    "test": best["test"],
                    "validation": bundle["validation_metrics"],
                    "metrics_at_default_threshold": bundle["metrics_at_default_threshold"],
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        logger.info("Wrote metrics to %s", METRICS_PATH)
    return bundle


def main() -> None:  # pragma: no cover - CLI
    parser = argparse.ArgumentParser(description="Train the DisasterIQ classifier")
    parser.add_argument("--only", nargs="*", help="restrict to these candidate names")
    parser.add_argument("--fast", action="store_true", help="skip embedding candidates")
    parser.add_argument("--no-save", action="store_true", help="benchmark without saving")
    args = parser.parse_args()
    logging.basicConfig(
        level=get_settings().log_level, format="%(levelname)s %(name)s: %(message)s"
    )
    train(only=args.only, fast=args.fast, save=not args.no_save)


if __name__ == "__main__":  # pragma: no cover
    main()
