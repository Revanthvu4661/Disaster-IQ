"""Loading and serving the trained model bundle.

Responsibilities:

* load the joblib bundle, auto-training when it is missing;
* detect a scikit-learn version mismatch (or an old bundle schema) and retrain
  instead of unpickling something that may behave differently;
* run a prediction with the tuned per-label thresholds;
* produce word-level explanations from the linear explainer model.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import joblib
import numpy as np
import sklearn

from backend.config import get_settings
from backend.services.events import event_from_text_only
from backend.services.severity import compute_severity

logger = logging.getLogger(__name__)

BUNDLE_SCHEMA_VERSION = 2


class ModelUnavailable(RuntimeError):
    """Raised when no model could be loaded or trained."""


@dataclass
class PredictionResult:
    """One classified message, ready to be serialised by the API layer."""

    message: str
    categories: list[dict]
    triggered: list[dict]
    severity: dict
    event: str
    explanations: dict[str, list[dict]]
    language: dict
    translation: dict

    @property
    def probabilities(self) -> dict[str, float]:
        return {c["category"]: c["confidence"] for c in self.categories}

    @property
    def triggered_names(self) -> list[str]:
        return [c["category"] for c in self.triggered]


def _version_mismatch(bundle: dict) -> str | None:
    """Return a reason string when the bundle cannot be trusted, else None."""
    if bundle.get("schema_version") != BUNDLE_SCHEMA_VERSION:
        return f"schema {bundle.get('schema_version')} != {BUNDLE_SCHEMA_VERSION}"
    trained_with = str(bundle.get("sklearn_version", "unknown"))
    running = sklearn.__version__
    if trained_with.split(".")[:2] != running.split(".")[:2]:
        return f"scikit-learn {trained_with} != {running}"
    return None


def _smoke_test(bundle: dict) -> str | None:
    """Try one prediction; returns an error string when the predictor is broken.

    The winning predictor may depend on files or optional packages that are not
    present in every deployment (the DistilBERT weights directory, torch). This
    keeps the API serving instead of failing on the first request.
    """
    try:
        proba = bundle["predictor"].predict_proba(["water and food needed"])
        if proba.shape[1] != len(bundle["category_names"]):
            return "predictor returned an unexpected number of labels"
        return None
    except Exception as exc:  # noqa: BLE001
        return f"{type(exc).__name__}: {exc}"


def load_bundle(path: Path | None = None, allow_train: bool | None = None) -> dict:
    """Load the model bundle, retraining when missing or stale."""
    settings = get_settings()
    target = Path(path or settings.model_path)
    allow_train = settings.auto_train if allow_train is None else allow_train

    if target.exists():
        try:
            bundle = joblib.load(target)
            reason = _version_mismatch(bundle)
            if reason is None:
                broken = _smoke_test(bundle)
                if broken is not None:
                    explainer = bundle.get("explainer")
                    if explainer is not None and explainer is not bundle["predictor"]:
                        logger.warning(
                            "Model: %s is unusable (%s); serving the explainer model %s instead",
                            bundle.get("model_name"), broken, explainer.name,
                        )
                        bundle = {
                            **bundle,
                            "predictor": explainer,
                            "model_name": f"{explainer.name} (fallback)",
                            "degraded_from": bundle.get("model_name"),
                            "degraded_reason": broken,
                        }
                    else:
                        logger.warning("Model: predictor unusable (%s)", broken)
                        raise RuntimeError(broken)
                logger.info(
                    "Model: loaded %s (test macro-F1 %.4f, trained %s)",
                    bundle.get("model_name"), bundle.get("macro_f1", 0.0),
                    bundle.get("trained_at"),
                )
                return bundle
            logger.warning("Model: bundle unusable (%s)", reason)
        except Exception as exc:  # noqa: BLE001 - corrupt or incompatible pickle
            logger.warning("Model: failed to load bundle (%s)", exc)
    else:
        logger.warning("Model: no bundle at %s", target)

    if not allow_train:
        raise ModelUnavailable(
            f"No usable model at {target}. Run: python -m backend.model.train_model"
        )

    logger.info("Model: training a new bundle (this takes a few minutes)")
    from backend.model.train_model import train

    return train(fast=True)


class ModelService:
    """Thin wrapper that turns raw text into predictions, severity and plans."""

    def __init__(self, bundle: dict):
        self.bundle = bundle
        self.predictor = bundle["predictor"]
        self.explainer = bundle.get("explainer")
        self.categories: list[str] = list(bundle["category_names"])
        self.thresholds: list[float] = list(bundle["thresholds"])
        self._index = {c: i for i, c in enumerate(self.categories)}

    # ── metadata ──────────────────────────────────────────────────────────
    @property
    def info(self) -> dict[str, Any]:
        b = self.bundle
        return {
            "model_name": b.get("model_name"),
            "macro_f1": b.get("macro_f1"),
            "micro_f1": b.get("metrics", {}).get("micro_f1"),
            "macro_pr_auc": b.get("metrics", {}).get("macro_pr_auc"),
            "trained_at": b.get("trained_at"),
            "sklearn_version": b.get("sklearn_version"),
            "python_version": b.get("python_version"),
            "categories": len(self.categories),
            "split": b.get("split", {}),
            "dataset_rows": b.get("dataset_rows"),
            "supports_explanations": bool(self.explainer),
            "baseline_macro_f1_at_0_5": b.get("metrics_at_default_threshold", {}).get(
                "macro_f1"
            ),
        }

    # ── prediction ────────────────────────────────────────────────────────
    def predict_proba(self, messages: Sequence[str]) -> np.ndarray:
        return self.predictor.predict_proba(list(messages))

    def classify(
        self,
        message: str,
        proba_row: np.ndarray | None = None,
        explain: bool = True,
        language: dict | None = None,
        translation: dict | None = None,
        max_explained: int = 5,
    ) -> PredictionResult:
        """Classify one message and assemble everything the UI needs."""
        proba = (
            proba_row if proba_row is not None else self.predict_proba([message])[0]
        )
        categories: list[dict] = []
        for name, p, t in zip(self.categories, proba, self.thresholds):
            categories.append(
                {
                    "category": name,
                    "confidence": round(float(p), 4),
                    "threshold": round(float(t), 2),
                    "triggered": bool(p >= t),
                }
            )
        categories.sort(key=lambda c: c["confidence"], reverse=True)
        triggered = [c for c in categories if c["triggered"]]

        severity = compute_severity(proba, self.categories)
        event = event_from_text_only(message)

        explanations: dict[str, list[dict]] = {}
        if explain and self.explainer is not None:
            for entry in triggered[:max_explained]:
                idx = self._index[entry["category"]]
                terms = self.explainer.explain(message, idx, top_k=6)
                if terms:
                    explanations[entry["category"]] = terms

        return PredictionResult(
            message=message,
            categories=categories,
            triggered=triggered,
            severity=severity,
            event=event,
            explanations=explanations,
            language=language or {},
            translation=translation or {},
        )

    # ── explainability ────────────────────────────────────────────────────
    def global_terms(self, category: str, top_k: int = 15) -> list[dict]:
        """Highest-weight features for a category, from the linear explainer."""
        if self.explainer is None or category not in self._index:
            return []
        getter = getattr(self.explainer, "global_terms", None)
        if getter is None:
            return []
        return getter(self._index[category], top_k)

    def highlight_spans(self, message: str, explanations: dict[str, list[dict]]) -> list[dict]:
        """Character spans to highlight in the UI, with their contributions.

        Terms may be bigrams; both the whole phrase and single words are matched
        on word boundaries, and overlapping spans keep the strongest signal.
        """
        spans: list[dict] = []
        for category, terms in explanations.items():
            for term in terms:
                pattern = re.compile(
                    r"\b" + r"\s+".join(re.escape(w) for w in term["term"].split()) + r"\b",
                    re.I,
                )
                for match in pattern.finditer(message):
                    spans.append(
                        {
                            "start": match.start(),
                            "end": match.end(),
                            "text": match.group(0),
                            "category": category,
                            "contribution": term["contribution"],
                        }
                    )
        spans.sort(key=lambda s: (-abs(s["contribution"]), s["start"]))
        chosen: list[dict] = []
        for span in spans:
            if any(not (span["end"] <= c["start"] or span["start"] >= c["end"]) for c in chosen):
                continue
            chosen.append(span)
        chosen.sort(key=lambda s: s["start"])
        return chosen

    # ── model performance ─────────────────────────────────────────────────
    def performance(self) -> dict[str, Any]:
        """Per-label test metrics and the candidate comparison table."""
        metrics = self.bundle.get("metrics", {})
        return {
            "model_name": self.bundle.get("model_name"),
            "trained_at": self.bundle.get("trained_at"),
            "split": self.bundle.get("split", {}),
            "macro_f1": metrics.get("macro_f1"),
            "micro_f1": metrics.get("micro_f1"),
            "weighted_f1": metrics.get("weighted_f1"),
            "samples_f1": metrics.get("samples_f1"),
            "macro_pr_auc": metrics.get("macro_pr_auc"),
            "exact_match": metrics.get("exact_match"),
            "hamming_accuracy": metrics.get("hamming_accuracy"),
            "per_label": metrics.get("per_label", []),
            "comparison": self.bundle.get("comparison", []),
            "metrics_at_default_threshold": self.bundle.get(
                "metrics_at_default_threshold", {}
            ),
        }

    def label_curves(self, category: str) -> dict[str, Any]:
        """PR curve and F1-vs-threshold for one label, from stored test scores."""
        from backend.model.evaluate import f1_vs_threshold, pr_curve

        if category not in self._index:
            raise KeyError(category)
        proba = self.bundle.get("test_proba")
        labels = self.bundle.get("test_labels")
        if proba is None or labels is None:
            return {"category": category, "available": False}
        j = self._index[category]
        y = np.asarray(labels)[:, j]
        p = np.asarray(proba)[:, j]
        return {
            "category": category,
            "available": True,
            "threshold": round(float(self.thresholds[j]), 2),
            "pr_curve": pr_curve(y, p),
            "f1_by_threshold": f1_vs_threshold(y, p),
            "support": int(y.sum()),
        }
