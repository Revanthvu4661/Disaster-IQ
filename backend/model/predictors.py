"""Candidate multi-label classifiers for disaster-message triage.

Each predictor exposes the same small interface so the benchmark in
``train_model`` can treat them interchangeably:

``fit(X, Y)``            train on raw text and a binary label matrix
``predict_proba(X)``     -> ``(n_samples, n_labels)`` probabilities
``explain(text, idx)``   -> top contributing n-grams for one label (optional)

All classes are defined at module level so joblib can pickle a fitted instance
into the model bundle.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Sequence

import numpy as np
from scipy import sparse
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, SGDClassifier
from sklearn.naive_bayes import ComplementNB
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.preprocessing import MaxAbsScaler
from sklearn.svm import LinearSVC

from backend.services.text import is_informative

logger = logging.getLogger(__name__)


def enable_system_certificates() -> None:
    """Use the OS trust store for HTTPS.

    Model downloads fail with ``CERTIFICATE_VERIFY_FAILED`` behind TLS-inspecting
    proxies (corporate networks, WARP). ``truststore`` is optional; without it
    the download simply proceeds with the default bundle.
    """
    try:
        import truststore  # type: ignore

        truststore.inject_into_ssl()
    except Exception:  # noqa: BLE001 - optional convenience only
        pass


def build_vectorizer(char_ngrams: bool = True) -> FeatureUnion | TfidfVectorizer:
    """Word (1-2) TF-IDF, optionally unioned with character (3-5) TF-IDF.

    Character n-grams help on this corpus because many messages are
    transliterated or contain misspellings from SMS-style input.
    """
    word = TfidfVectorizer(
        strip_accents="unicode",
        analyzer="word",
        ngram_range=(1, 2),
        max_features=60_000,
        sublinear_tf=True,
        min_df=2,
    )
    if not char_ngrams:
        return word
    char = TfidfVectorizer(
        strip_accents="unicode",
        analyzer="char_wb",
        ngram_range=(3, 5),
        max_features=60_000,
        sublinear_tf=True,
        min_df=3,
    )
    return FeatureUnion([("word", word), ("char", char)])


class BasePredictor:
    """Common interface. Subclasses must set ``self.name``."""

    name: str = "base"
    supports_explain: bool = False

    def fit(self, X: Sequence[str], Y: np.ndarray) -> "BasePredictor":  # pragma: no cover
        raise NotImplementedError

    def predict_proba(self, X: Sequence[str]) -> np.ndarray:  # pragma: no cover
        raise NotImplementedError

    def explain(self, text: str, label_index: int, top_k: int = 8) -> list[dict]:
        """Top contributing n-grams for one label. Empty when unsupported."""
        return []

    def describe(self) -> dict[str, Any]:
        return {"name": self.name, "supports_explain": self.supports_explain}


class TfidfLinearPredictor(BasePredictor):
    """TF-IDF -> one linear classifier per label (one-vs-rest).

    ``kind`` selects the estimator:

    * ``logreg``     - LogisticRegression, ``class_weight="balanced"``
    * ``sgd``        - SGDClassifier(modified_huber), balanced
    * ``linearsvc``  - LinearSVC wrapped in Platt calibration for probabilities
    """

    supports_explain = True

    def __init__(self, kind: str = "logreg", char_ngrams: bool = True, C: float = 4.0):
        self.kind = kind
        self.char_ngrams = char_ngrams
        self.C = C
        self.name = f"tfidf_{kind}" + ("_wordchar" if char_ngrams else "_word")
        self.vectorizer = build_vectorizer(char_ngrams)
        self.scaler = MaxAbsScaler()
        self.estimators_: list[Any] = []
        self.constant_: list[int | None] = []

    def _make_estimator(self):
        if self.kind == "logreg":
            return LogisticRegression(
                C=self.C,
                class_weight="balanced",
                solver="liblinear",
                max_iter=2000,
            )
        if self.kind == "sgd":
            return SGDClassifier(
                loss="modified_huber",
                penalty="l2",
                alpha=1e-5,
                max_iter=1500,
                tol=1e-4,
                class_weight="balanced",
                random_state=42,
            )
        if self.kind == "linearsvc":
            return CalibratedClassifierCV(
                LinearSVC(C=0.5, class_weight="balanced", max_iter=5000),
                method="sigmoid",
                cv=3,
            )
        raise ValueError(f"unknown kind {self.kind!r}")

    def fit(self, X: Sequence[str], Y: np.ndarray) -> "TfidfLinearPredictor":
        Xt = self.scaler.fit_transform(self.vectorizer.fit_transform(X))
        self.estimators_ = []
        self.constant_ = []
        for j in range(Y.shape[1]):
            col = Y[:, j]
            if col.sum() == 0 or col.sum() == len(col):
                # A constant label cannot be fitted; remember the value.
                self.estimators_.append(None)
                self.constant_.append(int(col[0]) if len(col) else 0)
                continue
            est = self._make_estimator()
            est.fit(Xt, col)
            self.estimators_.append(est)
            self.constant_.append(None)
        return self

    def transform(self, X: Sequence[str]):
        return self.scaler.transform(self.vectorizer.transform(X))

    def predict_proba(self, X: Sequence[str]) -> np.ndarray:
        Xt = self.transform(X)
        out = np.zeros((Xt.shape[0], len(self.estimators_)))
        for j, est in enumerate(self.estimators_):
            if est is None:
                out[:, j] = float(self.constant_[j] or 0)
            else:
                out[:, j] = est.predict_proba(Xt)[:, 1]
        return out

    # ── explainability ────────────────────────────────────────────────────
    def _coef(self, label_index: int) -> np.ndarray | None:
        est = self.estimators_[label_index]
        if est is None:
            return None
        if isinstance(est, CalibratedClassifierCV):
            coefs = [c.estimator.coef_.ravel() for c in est.calibrated_classifiers_]
            return np.mean(coefs, axis=0)
        return est.coef_.ravel()

    def feature_names(self) -> np.ndarray:
        return np.asarray(self.vectorizer.get_feature_names_out())

    def explain(self, text: str, label_index: int, top_k: int = 8) -> list[dict]:
        """Contribution of each present n-gram: ``tfidf_value * coefficient``.

        Only positive contributions are returned - evidence *for* the label is
        what an operator needs to see - and stopword-only n-grams are dropped
        because "we are" is not an explanation.
        """
        coef = self._coef(label_index)
        if coef is None:
            return []
        row = sparse.csr_matrix(self.transform([text]))
        names = self.feature_names()
        idx = row.indices
        contrib = row.data * coef[idx]
        order = np.argsort(-contrib)[: top_k * 6]
        out: list[dict] = []
        seen: set[str] = set()
        for k in order:
            if contrib[k] <= 0:
                break
            term = str(names[idx[k]])
            # Character n-grams are unreadable in a UI, keep word features.
            if term.startswith("char__"):
                continue
            clean = term.split("__", 1)[-1].strip()
            if not clean or clean in seen or len(clean) < 2 or not is_informative(clean):
                continue
            seen.add(clean)
            out.append({"term": clean, "contribution": round(float(contrib[k]), 4)})
            if len(out) >= top_k:
                break
        return out

    def global_terms(self, label_index: int, top_k: int = 15) -> list[dict]:
        """Highest-weight word features for a label, independent of any message."""
        coef = self._coef(label_index)
        if coef is None:
            return []
        names = self.feature_names()
        order = np.argsort(-coef)
        out: list[dict] = []
        for k in order:
            term = str(names[k])
            if "char__" in term:
                continue
            clean = term.split("__", 1)[-1].strip()
            if not clean or len(clean) < 2 or not is_informative(clean):
                continue
            out.append({"term": clean, "weight": round(float(coef[k]), 4)})
            if len(out) >= top_k:
                break
        return out


class EnsemblePredictor(BasePredictor):
    """Soft vote of a balanced SGD and a ComplementNB pipeline.

    This is the tuned version of the original DisasterIQ model, kept as the
    baseline in the benchmark.
    """

    supports_explain = True

    def __init__(self, sgd_weight: float = 0.6, char_ngrams: bool = False):
        self.sgd_weight = sgd_weight
        self.name = "ensemble_sgd_cnb"
        self.sgd = TfidfLinearPredictor(kind="sgd", char_ngrams=char_ngrams)
        self.nb_vectorizer = build_vectorizer(char_ngrams=False)
        self.nb_estimators_: list[Any] = []
        self.nb_constant_: list[int | None] = []

    def fit(self, X: Sequence[str], Y: np.ndarray) -> "EnsemblePredictor":
        self.sgd.fit(X, Y)
        Xt = self.nb_vectorizer.fit_transform(X)
        self.nb_estimators_ = []
        self.nb_constant_ = []
        for j in range(Y.shape[1]):
            col = Y[:, j]
            if col.sum() == 0 or col.sum() == len(col):
                self.nb_estimators_.append(None)
                self.nb_constant_.append(int(col[0]) if len(col) else 0)
                continue
            est = ComplementNB(alpha=0.1)
            est.fit(Xt, col)
            self.nb_estimators_.append(est)
            self.nb_constant_.append(None)
        return self

    def predict_proba(self, X: Sequence[str]) -> np.ndarray:
        p_sgd = self.sgd.predict_proba(X)
        Xt = self.nb_vectorizer.transform(X)
        p_nb = np.zeros_like(p_sgd)
        for j, est in enumerate(self.nb_estimators_):
            if est is None:
                p_nb[:, j] = float(self.nb_constant_[j] or 0)
            else:
                p_nb[:, j] = est.predict_proba(Xt)[:, 1]
        return self.sgd_weight * p_sgd + (1 - self.sgd_weight) * p_nb

    def explain(self, text: str, label_index: int, top_k: int = 8) -> list[dict]:
        return self.sgd.explain(text, label_index, top_k)

    def global_terms(self, label_index: int, top_k: int = 15) -> list[dict]:
        return self.sgd.global_terms(label_index, top_k)


class EmbeddingLinearPredictor(BasePredictor):
    """Sentence-transformer embeddings -> logistic regression head per label.

    Requires ``sentence-transformers``. The encoder is not pickled (it is
    reloaded by name on unpickle) to keep the bundle small.
    """

    supports_explain = False

    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2"):
        self.model_name = model_name
        self.name = "minilm_logreg"
        self.estimators_: list[Any] = []
        self.constant_: list[int | None] = []
        self._encoder = None

    # ── encoder handling ──────────────────────────────────────────────────
    @property
    def encoder(self):
        if self._encoder is None:
            enable_system_certificates()
            from sentence_transformers import SentenceTransformer  # local import

            self._encoder = SentenceTransformer(self.model_name)
        return self._encoder

    def __getstate__(self) -> dict:
        state = self.__dict__.copy()
        state["_encoder"] = None
        return state

    def encode(self, X: Sequence[str]) -> np.ndarray:
        return np.asarray(
            self.encoder.encode(
                list(X), batch_size=128, show_progress_bar=False, normalize_embeddings=True
            )
        )

    def fit(self, X: Sequence[str], Y: np.ndarray) -> "EmbeddingLinearPredictor":
        E = self.encode(X)
        self.estimators_ = []
        self.constant_ = []
        for j in range(Y.shape[1]):
            col = Y[:, j]
            if col.sum() == 0 or col.sum() == len(col):
                self.estimators_.append(None)
                self.constant_.append(int(col[0]) if len(col) else 0)
                continue
            est = LogisticRegression(C=4.0, class_weight="balanced", max_iter=3000)
            est.fit(E, col)
            self.estimators_.append(est)
            self.constant_.append(None)
        return self

    def predict_proba(self, X: Sequence[str]) -> np.ndarray:
        E = self.encode(X)
        out = np.zeros((len(E), len(self.estimators_)))
        for j, est in enumerate(self.estimators_):
            if est is None:
                out[:, j] = float(self.constant_[j] or 0)
            else:
                out[:, j] = est.predict_proba(E)[:, 1]
        return out


class DistilBertPredictor(BasePredictor):
    """Fine-tuned DistilBERT multi-label head.

    Only benchmarked when a CUDA device is available (see
    ``is_available``); the fitted weights are written to ``artifact_dir`` and
    reloaded lazily, so the joblib bundle stays small.
    """

    supports_explain = False

    def __init__(
        self,
        artifact_dir: str | None = None,
        model_name: str = "distilbert-base-multilingual-cased",
        epochs: int = 3,
        batch_size: int = 32,
        max_length: int = 96,
        lr: float = 3e-5,
    ):
        from backend.config import MODEL_DIR

        self.name = "distilbert"
        self.model_name = model_name
        self.artifact_dir = str(artifact_dir or (MODEL_DIR / "distilbert_artifact"))
        self.epochs = epochs
        self.batch_size = batch_size
        self.max_length = max_length
        self.lr = lr
        self.n_labels = 0
        self._model = None
        self._tokenizer = None

    @staticmethod
    def is_available() -> bool:
        """True when torch with a usable CUDA device is importable."""
        try:
            import torch

            return bool(torch.cuda.is_available())
        except Exception:  # noqa: BLE001
            return False

    def __getstate__(self) -> dict:
        state = self.__dict__.copy()
        state["_model"] = None
        state["_tokenizer"] = None
        return state

    def _load(self):
        if self._model is None:
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer

            enable_system_certificates()
            self._tokenizer = AutoTokenizer.from_pretrained(self.artifact_dir)
            self._model = AutoModelForSequenceClassification.from_pretrained(
                self.artifact_dir
            )
            self._model.to("cuda" if torch.cuda.is_available() else "cpu").eval()
        return self._model, self._tokenizer

    def fit(self, X: Sequence[str], Y: np.ndarray) -> "DistilBertPredictor":
        import torch
        from torch.utils.data import DataLoader, TensorDataset
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        enable_system_certificates()
        device = "cuda" if torch.cuda.is_available() else "cpu"
        self.n_labels = int(Y.shape[1])
        tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        model = AutoModelForSequenceClassification.from_pretrained(
            self.model_name,
            num_labels=self.n_labels,
            problem_type="multi_label_classification",
        ).to(device)

        enc = tokenizer(
            list(X), truncation=True, padding="max_length",
            max_length=self.max_length, return_tensors="pt",
        )
        labels = torch.tensor(np.asarray(Y, dtype=np.float32))
        loader = DataLoader(
            TensorDataset(enc["input_ids"], enc["attention_mask"], labels),
            batch_size=self.batch_size, shuffle=True,
        )

        # Class balancing: positive weight per label, capped so ultra-rare
        # labels do not destabilise training.
        pos = np.asarray(Y).sum(axis=0)
        neg = len(Y) - pos
        pos_weight = torch.tensor(
            np.clip(neg / np.maximum(pos, 1), 1.0, 20.0), dtype=torch.float32
        ).to(device)
        loss_fn = torch.nn.BCEWithLogitsLoss(pos_weight=pos_weight)
        optim = torch.optim.AdamW(model.parameters(), lr=self.lr)
        steps = self.epochs * len(loader)
        sched = torch.optim.lr_scheduler.OneCycleLR(
            optim, max_lr=self.lr, total_steps=steps, pct_start=0.1
        )
        scaler = torch.amp.GradScaler("cuda", enabled=device == "cuda")

        model.train()
        for epoch in range(self.epochs):
            running = 0.0
            for ids, mask, y in loader:
                ids, mask, y = ids.to(device), mask.to(device), y.to(device)
                optim.zero_grad(set_to_none=True)
                with torch.amp.autocast("cuda", enabled=device == "cuda"):
                    logits = model(input_ids=ids, attention_mask=mask).logits
                    loss = loss_fn(logits, y)
                scaler.scale(loss).backward()
                scaler.step(optim)
                scaler.update()
                sched.step()
                running += float(loss)
            logger.info("distilbert epoch %d/%d loss %.4f", epoch + 1, self.epochs,
                        running / max(len(loader), 1))

        Path(self.artifact_dir).mkdir(parents=True, exist_ok=True)
        model.save_pretrained(self.artifact_dir)
        tokenizer.save_pretrained(self.artifact_dir)
        self._model, self._tokenizer = model.eval(), tokenizer
        return self

    def predict_proba(self, X: Sequence[str]) -> np.ndarray:
        import torch

        model, tokenizer = self._load()
        device = next(model.parameters()).device
        out = np.zeros((len(X), self.n_labels), dtype=np.float32)
        batch = 128
        with torch.no_grad():
            for i in range(0, len(X), batch):
                chunk = list(X[i : i + batch])
                enc = tokenizer(
                    chunk, truncation=True, padding=True,
                    max_length=self.max_length, return_tensors="pt",
                ).to(device)
                logits = model(**enc).logits
                out[i : i + batch] = torch.sigmoid(logits).float().cpu().numpy()
        return out
