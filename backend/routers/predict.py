"""Prediction endpoints: single message, JSON batch and CSV upload."""

from __future__ import annotations

import csv
import io
import logging
import time
from collections import Counter
from typing import Any, Sequence

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from backend import schemas
from backend.config import get_settings
from backend.etl import META_CATEGORIES
from backend.rate_limit import limiter
from backend.services.incident import build_incident_summary
from backend.services.language import prepare_for_classification
from backend.services.recommend import forecast_resource_demand, recommend
from backend.services.severity import LEVEL_ORDER
from backend.state import state

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["prediction"])

CSV_TEXT_COLUMNS = ("message", "text", "body", "content", "msg", "tweet")


def _plan(result, rules) -> dict[str, Any]:
    return recommend(
        probabilities=result.probabilities,
        severity=result.severity,
        event=result.event,
        triggered=result.triggered_names,
        ruleset=rules,
    )


@router.post("/predict", response_model=schemas.PredictResponse)
@limiter.limit(lambda: get_settings().predict_rate_limit)
def predict(request: Request, body: schemas.PredictRequest) -> dict[str, Any]:
    """Classify one message: categories, severity, explanation and action plan.

    Non-English input is detected and translated first when a translation
    backend is available; otherwise the original text is classified and the
    response says translation was unavailable.
    """
    model = state.require_model()
    rules = state.require_rules()

    if body.translate:
        prepared = prepare_for_classification(body.message)
    else:
        prepared = {
            "language": None,
            "text_for_model": body.message,
            "translation": {"text": None, "translated": False, "backend": None, "error": None},
        }

    result = model.classify(
        prepared["text_for_model"],
        explain=body.explain,
        language=prepared["language"] or {},
        translation=prepared["translation"],
    )

    plan = _plan(result, rules) if body.recommend else None
    highlights = (
        model.highlight_spans(prepared["text_for_model"], result.explanations)
        if body.explain
        else []
    )
    summary = build_incident_summary(
        body.message,
        result.severity,
        result.triggered_names,
        result.event,
        plan["actions"] if plan else (),
        prepared["language"],
    )

    translation = dict(prepared["translation"])
    if translation.get("translated"):
        translation["text"] = prepared["text_for_model"]

    return {
        "message": body.message,
        "classified_text": prepared["text_for_model"],
        "predictions": result.categories,
        "triggered_categories": result.triggered_names,
        "triggered_count": len(result.triggered),
        "severity": result.severity,
        "event": result.event,
        "explanations": result.explanations,
        "highlights": highlights,
        "language": prepared["language"],
        "translation": translation,
        "recommendation": plan,
        "incident_summary": summary,
        "model_name": model.info["model_name"],
        "model_macro_f1": model.info["macro_f1"],
    }


def _triage(messages: Sequence[str], explain: bool, want_plan: bool) -> dict[str, Any]:
    """Shared batch pipeline for the JSON and CSV endpoints."""
    model = state.require_model()
    rules = state.require_rules()
    started = time.perf_counter()

    proba = model.predict_proba(list(messages))
    items: list[dict[str, Any]] = []
    plans: list[dict[str, Any]] = []
    predictions: list[dict[str, Any]] = []

    for index, (message, row) in enumerate(zip(messages, proba)):
        result = model.classify(message, proba_row=row, explain=explain)
        plan = _plan(result, rules) if want_plan else None
        if plan:
            plans.append(plan)
        predictions.append({"triggered_categories": result.triggered_names})
        # The most useful "top label" is a need, not a meta label such as
        # `related` or `request`, which fire on almost every message.
        needs = [c for c in result.categories if c["category"] not in META_CATEGORIES]
        top = (needs or result.categories)[0] if result.categories else None
        items.append(
            {
                "index": index,
                "message": message,
                "severity": result.severity,
                "event": result.event,
                "triggered_categories": result.triggered_names,
                "top_category": top["category"] if top else None,
                "top_confidence": top["confidence"] if top else 0.0,
                "recommendation": plan,
                "language": None,
            }
        )

    items.sort(key=lambda i: i["severity"]["score"], reverse=True)
    severity_counts = Counter(i["severity"]["level"] for i in items)
    return {
        "count": len(items),
        "items": items,
        "severity_breakdown": {level: severity_counts.get(level, 0) for level in LEVEL_ORDER},
        "event_breakdown": dict(Counter(i["event"] for i in items)),
        "forecast": forecast_resource_demand(plans, predictions),
        "top_urgent": items[:10],
        "skipped": 0,
        "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
    }


@router.post("/predict/batch", response_model=schemas.BatchPredictResponse)
@limiter.limit(lambda: get_settings().batch_rate_limit)
def predict_batch(
    request: Request, body: schemas.BatchPredictRequest
) -> dict[str, Any]:
    """Triage a list of messages, sorted by severity, with a demand forecast."""
    settings = get_settings()
    if len(body.messages) > settings.batch_max_messages:
        raise HTTPException(
            status_code=413,
            detail=f"at most {settings.batch_max_messages} messages per request",
        )
    return _triage(body.messages, explain=body.explain, want_plan=body.recommend)


@router.post("/predict/batch-csv", response_model=schemas.BatchPredictResponse)
@limiter.limit(lambda: get_settings().batch_rate_limit)
async def predict_batch_csv(
    request: Request, file: UploadFile = File(...)
) -> dict[str, Any]:
    """Triage a CSV upload.

    The text column is detected from a list of common names (``message``,
    ``text``, ``body``, ...); a single-column file without a header also works.
    """
    settings = get_settings()
    raw = await file.read()
    if len(raw) > settings.batch_max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"file larger than {settings.batch_max_bytes // 1024} KB",
        )
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        raise HTTPException(status_code=400, detail="the CSV file is empty")

    header = [h.strip().lower() for h in rows[0]]
    column = next((header.index(c) for c in CSV_TEXT_COLUMNS if c in header), None)
    if column is None:
        if len(header) == 1:
            column, body_rows = 0, rows  # single column, no header
        else:
            raise HTTPException(
                status_code=400,
                detail=(
                    "no text column found. Expected one of: "
                    + ", ".join(CSV_TEXT_COLUMNS)
                ),
            )
    else:
        body_rows = rows[1:]

    messages: list[str] = []
    skipped = 0
    for row in body_rows:
        value = row[column].strip() if len(row) > column else ""
        if len(value) < 3:
            skipped += 1
            continue
        messages.append(value)
        if len(messages) >= settings.batch_max_messages:
            break

    if not messages:
        raise HTTPException(status_code=400, detail="no usable messages in the file")

    payload = _triage(messages, explain=False, want_plan=True)
    payload["skipped"] = skipped
    return payload
