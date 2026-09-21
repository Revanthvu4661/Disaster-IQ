"""Precomputed analytics over the cleaned message corpus.

Everything expensive (co-occurrence matrices, per-category term statistics) is
computed once by :func:`build_analytics` and cached, because the previous
implementation recomputed it on every request.

The dataset has no timestamps, so nothing here pretends to be a time series.
Where a trend line is useful the corpus is bucketed by ``id`` order, which is
the only sequencing signal available, and it is labelled as such.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Iterable

import numpy as np
import pandas as pd

from backend.etl import (
    META_CATEGORIES,
    category_columns,
    need_columns,
    relevant,
)
from backend.services.events import EVENTS
from backend.services.text import STOPWORDS, tokens as _tokens
from backend.services.severity import SEVERITY_WEIGHTS

logger = logging.getLogger(__name__)

SPARKLINE_BUCKETS = 12


@dataclass
class Analytics:
    """Container for every precomputed analytics payload."""

    summary: dict[str, Any] = field(default_factory=dict)
    category_distribution: list[dict] = field(default_factory=list)
    volume_by_event: list[dict] = field(default_factory=list)
    volume_by_genre: list[dict] = field(default_factory=list)
    event_category_mix: dict[str, Any] = field(default_factory=dict)
    genre_event_matrix: dict[str, Any] = field(default_factory=dict)
    cooccurrence: dict[str, Any] = field(default_factory=dict)
    needs_bundles: list[dict] = field(default_factory=list)
    message_length: dict[str, Any] = field(default_factory=dict)
    top_terms: dict[str, list[dict]] = field(default_factory=dict)
    urgent_terms: list[dict] = field(default_factory=list)
    data_quality: dict[str, Any] = field(default_factory=dict)
    events: list[str] = field(default_factory=list)
    categories: list[str] = field(default_factory=list)


# ── individual builders ───────────────────────────────────────────────────────


def get_category_distribution(df: pd.DataFrame) -> list[dict]:
    """``[{category, count, share, is_need, is_urgent}]`` sorted descending."""
    rel = relevant(df)
    cats = category_columns(df)
    counts = rel[cats].sum().sort_values(ascending=False)
    total = max(len(rel), 1)
    return [
        {
            "category": name,
            "count": int(value),
            "share": round(float(value) / total, 4),
            "is_need": name not in META_CATEGORIES,
            "is_urgent": name in SEVERITY_WEIGHTS,
        }
        for name, value in counts.items()
    ]


def get_volume_by_event(df: pd.DataFrame) -> list[dict]:
    """Message volume per inferred disaster event, with inference provenance."""
    rel = relevant(df)
    out: list[dict] = []
    for event, group in rel.groupby("event"):
        methods = group["event_method"].value_counts().to_dict()
        out.append(
            {
                "event": event,
                "count": int(len(group)),
                "keyword_inferred": int(methods.get("keyword", 0)),
                "range_inferred": int(methods.get("id_range", 0)),
                "unassigned": int(methods.get("default", 0)),
            }
        )
    order = {e: i for i, e in enumerate(EVENTS)}
    out.sort(key=lambda r: order.get(r["event"], 99))
    return out


def get_volume_by_genre(df: pd.DataFrame) -> list[dict]:
    """Message volume per source genre (direct / news / social)."""
    rel = relevant(df)
    counts = rel["genre"].value_counts()
    total = max(int(counts.sum()), 1)
    return [
        {"genre": str(g), "count": int(c), "share": round(int(c) / total, 4)}
        for g, c in counts.items()
    ]


def get_event_category_mix(df: pd.DataFrame, top_n: int = 12) -> dict[str, Any]:
    """Need-category mix per event, as shares so events of different size compare."""
    rel = relevant(df)
    needs = need_columns(df)
    totals = rel[needs].sum().sort_values(ascending=False)
    top = [c for c in totals.head(top_n).index]

    rows: list[dict] = []
    for event, group in rel.groupby("event"):
        n = max(len(group), 1)
        entry: dict[str, Any] = {"event": event, "total": int(len(group))}
        for cat in top:
            entry[cat] = round(float(group[cat].sum()) / n, 4)
        top_need = group[needs].sum().idxmax() if len(group) else None
        entry["top_need"] = str(top_need) if top_need is not None else None
        rows.append(entry)
    order = {e: i for i, e in enumerate(EVENTS)}
    rows.sort(key=lambda r: order.get(r["event"], 99))
    return {"categories": top, "rows": rows}


def get_genre_event_matrix(df: pd.DataFrame) -> dict[str, Any]:
    """Counts of messages per (genre, event) pair for a heatmap."""
    rel = relevant(df)
    table = pd.crosstab(rel["genre"], rel["event"])
    events = [e for e in EVENTS if e in table.columns]
    genres = [str(g) for g in table.index]
    values = [[int(table.loc[g, e]) for e in events] for g in table.index]
    return {"genres": genres, "events": events, "values": values}


def get_cooccurrence(df: pd.DataFrame, categories: list[str] | None = None) -> dict[str, Any]:
    """Category co-occurrence via a single matrix product ``Y.T @ Y``.

    Returns the raw counts, the Jaccard-normalised matrix (better for a heatmap
    because frequent labels do not dominate) and the top pairs.
    """
    rel = relevant(df)
    cats = categories or need_columns(df)
    Y = rel[cats].to_numpy(dtype=np.int32)
    counts = Y.T @ Y
    diag = np.diag(counts).astype(float)
    union = diag[:, None] + diag[None, :] - counts
    with np.errstate(divide="ignore", invalid="ignore"):
        jaccard = np.where(union > 0, counts / union, 0.0)

    pairs: list[dict] = []
    for i in range(len(cats)):
        for j in range(i + 1, len(cats)):
            c = int(counts[i, j])
            if c:
                pairs.append(
                    {
                        "cat_a": cats[i],
                        "cat_b": cats[j],
                        "count": c,
                        "jaccard": round(float(jaccard[i, j]), 4),
                    }
                )
    pairs.sort(key=lambda p: p["count"], reverse=True)
    return {
        "categories": cats,
        "counts": counts.astype(int).tolist(),
        "jaccard": np.round(jaccard, 4).tolist(),
        "totals": [int(v) for v in diag],
        "top_pairs": pairs[:40],
    }


def get_needs_bundles(df: pd.DataFrame, top_n: int = 12, min_size: int = 2) -> list[dict]:
    """Most frequent exact combinations of need categories ("needs bundles")."""
    rel = relevant(df)
    needs = need_columns(df)
    sub = rel[needs]
    counter: Counter[tuple[str, ...]] = Counter()
    arr = sub.to_numpy(dtype=bool)
    names = np.array(needs)
    for row in arr:
        if row.sum() >= min_size:
            counter[tuple(names[row])] += 1
    total = max(len(rel), 1)
    return [
        {
            "categories": [str(c) for c in combo],
            "size": len(combo),
            "count": int(count),
            "share": round(count / total, 4),
        }
        for combo, count in counter.most_common(top_n)
    ]


def get_message_length(df: pd.DataFrame, bins: int = 12) -> dict[str, Any]:
    """Message-length histogram plus per-genre medians."""
    rel = relevant(df)
    lengths = rel["message_length"].to_numpy()
    edges = np.histogram_bin_edges(lengths, bins=bins, range=(0, float(np.percentile(lengths, 99))))
    hist, _ = np.histogram(lengths, bins=edges)
    return {
        "bins": [
            {"start": int(edges[i]), "end": int(edges[i + 1]), "count": int(hist[i])}
            for i in range(len(hist))
        ],
        "median": int(np.median(lengths)),
        "mean": round(float(np.mean(lengths)), 1),
        "p95": int(np.percentile(lengths, 95)),
        "by_genre": [
            {"genre": str(g), "median": int(np.median(grp["message_length"]))}
            for g, grp in rel.groupby("genre")
        ],
        "short_messages": int((lengths < 20).sum()),
    }


def get_top_terms(df: pd.DataFrame, top_n: int = 15) -> dict[str, list[dict]]:
    """Distinctive unigrams and bigrams per category.

    Scores a term by lift: its rate inside the category over its rate in the
    whole corpus, damped by frequency so that rare accidents do not win.
    """
    rel = relevant(df)
    cats = category_columns(df)
    docs = [_tokens(m) for m in rel["message"].astype(str)]
    grams: list[Counter[str]] = []
    for toks in docs:
        c = Counter(toks)
        c.update(f"{a} {b}" for a, b in zip(toks, toks[1:]))
        grams.append(c)

    global_counts: Counter[str] = Counter()
    for c in grams:
        global_counts.update(c.keys())
    n_docs = max(len(docs), 1)

    out: dict[str, list[dict]] = {}
    label_arrays = {c: rel[c].to_numpy(dtype=bool) for c in cats}
    for cat in cats:
        mask = label_arrays[cat]
        n_cat = int(mask.sum())
        if n_cat < 20:
            out[cat] = []
            continue
        local: Counter[str] = Counter()
        for c, keep in zip(grams, mask):
            if keep:
                local.update(c.keys())
        scored: list[dict] = []
        for term, count in local.items():
            if count < 5:
                continue
            rate_in = count / n_cat
            rate_all = global_counts[term] / n_docs
            lift = rate_in / rate_all if rate_all else 0.0
            scored.append(
                {
                    "term": term,
                    "count": int(count),
                    "share": round(rate_in, 4),
                    "lift": round(float(lift), 2),
                    "score": round(float(lift * np.log1p(count)), 3),
                }
            )
        scored.sort(key=lambda s: s["score"], reverse=True)
        out[cat] = scored[:top_n]
    return out


def get_urgent_terms(df: pd.DataFrame, top_n: int = 40) -> list[dict]:
    """Ranked terms in messages carrying at least one severity-weighted label."""
    rel = relevant(df)
    urgent_cols = [c for c in SEVERITY_WEIGHTS if c in rel.columns]
    mask = rel[urgent_cols].any(axis=1).to_numpy()
    counter: Counter[str] = Counter()
    base: Counter[str] = Counter()
    for msg, is_urgent in zip(rel["message"].astype(str), mask):
        toks = set(_tokens(msg))
        base.update(toks)
        if is_urgent:
            counter.update(toks)
    n_urgent = max(int(mask.sum()), 1)
    n_all = max(len(rel), 1)
    rows = [
        {
            "term": term,
            "count": int(count),
            "lift": round((count / n_urgent) / (base[term] / n_all), 2),
        }
        for term, count in counter.items()
        if count >= 25
    ]
    rows.sort(key=lambda r: r["count"] * r["lift"], reverse=True)
    return rows[:top_n]


def get_data_quality(df: pd.DataFrame) -> dict[str, Any]:
    """Data-quality panel: duplicates, noise share, imbalance, empties."""
    cats = category_columns(df)
    counts = df[cats].sum().sort_values()
    non_empty_counts = counts[counts > 0]
    rarest = [
        {"category": str(k), "count": int(v)} for k, v in non_empty_counts.head(5).items()
    ]
    return {
        "raw_rows": int(df.attrs.get("raw_rows", len(df))),
        "rows": int(len(df)),
        "duplicates_removed": int(df.attrs.get("duplicates_removed", 0)),
        "irrelevant_count": int(df["is_irrelevant"].sum()),
        "irrelevant_share": round(float(df["is_irrelevant"].mean()), 4),
        "empty_labels": [{"category": str(k), "count": 0} for k, v in counts.items() if v == 0],
        "rarest_labels": rarest,
        "short_messages": int((df["message_length"] < 20).sum()),
        "non_english_share": round(float(df["original"].notna().mean()), 4),
        "imbalance_ratio": round(
            float(non_empty_counts.max() / max(non_empty_counts.min(), 1)), 1
        ),
        "events_unassigned_share": round(
            float((df["event_method"] == "default").mean()), 4
        ),
    }


def _sparkline(series: pd.Series, buckets: int = SPARKLINE_BUCKETS) -> list[float]:
    """Bucket a boolean/numeric series over corpus order into a small series."""
    if series.empty:
        return []
    chunks = np.array_split(series.to_numpy(dtype=float), buckets)
    return [round(float(np.mean(c)), 4) if len(c) else 0.0 for c in chunks]


def get_summary_stats(df: pd.DataFrame) -> dict[str, Any]:
    """KPI block with corpus-order sparklines and deltas (last vs first bucket)."""
    rel = relevant(df)
    cats = category_columns(df)
    needs = need_columns(df)
    urgent_cols = [c for c in SEVERITY_WEIGHTS if c in rel.columns]

    urgent_mask = rel[urgent_cols].any(axis=1)
    urgent_spark = _sparkline(urgent_mask)
    counts = rel[needs].sum().sort_values(ascending=False)
    per_message = rel[cats].sum(axis=1)

    def delta(spark: list[float]) -> float:
        if len(spark) < 2 or spark[0] == 0:
            return 0.0
        return round((spark[-1] - spark[0]) / abs(spark[0]) * 100, 1)

    total_spark = [
        round(float(len(c)), 1) for c in np.array_split(np.arange(len(rel)), SPARKLINE_BUCKETS)
    ]
    cats_spark = _sparkline(per_message)

    return {
        "total_messages": int(len(df)),
        "analysed_messages": int(len(rel)),
        "total_categories": len(cats),
        "top_categories": [str(c) for c in counts.head(3).index],
        "genre_breakdown": {str(k): int(v) for k, v in rel["genre"].value_counts().items()},
        "event_breakdown": {str(k): int(v) for k, v in rel["event"].value_counts().items()},
        "urgent_messages": int(urgent_mask.sum()),
        "urgent_share": round(float(urgent_mask.mean()), 4),
        "most_requested_need": str(counts.index[0]) if len(counts) else None,
        "most_requested_need_count": int(counts.iloc[0]) if len(counts) else 0,
        "irrelevant_messages": int(df["is_irrelevant"].sum()),
        "irrelevant_share": round(float(df["is_irrelevant"].mean()), 4),
        "avg_categories_per_message": round(float(per_message.mean()), 2),
        "sparklines": {
            "total": total_spark,
            "urgent_share": urgent_spark,
            "avg_categories": cats_spark,
        },
        "deltas": {
            "urgent_share": delta(urgent_spark),
            "avg_categories": delta(cats_spark),
        },
        "sparkline_note": "Buckets follow corpus id order; the dataset has no timestamps.",
    }


def keyword_in_context(
    df: pd.DataFrame,
    query: str,
    limit: int = 25,
    window: int = 60,
    category: str | None = None,
    event: str | None = None,
) -> dict[str, Any]:
    """Keyword-in-context search: matching messages with surrounding text."""
    if not query.strip():
        return {"query": query, "total": 0, "results": []}
    sub = relevant(df)
    if category and category in sub.columns:
        sub = sub[sub[category] == 1]
    if event:
        sub = sub[sub["event"] == event]

    pattern = re.compile(re.escape(query.strip()), re.I)
    results: list[dict] = []
    total = 0
    for row in sub.itertuples(index=False):
        match = pattern.search(row.message)
        if not match:
            continue
        total += 1
        if len(results) >= limit:
            continue
        start, end = match.span()
        results.append(
            {
                "id": int(row.id),
                "before": row.message[max(0, start - window) : start],
                "match": row.message[start:end],
                "after": row.message[end : end + window],
                "genre": row.genre,
                "event": row.event,
            }
        )
    return {"query": query, "total": total, "results": results}


# ── orchestration ─────────────────────────────────────────────────────────────


def build_analytics(df: pd.DataFrame) -> Analytics:
    """Compute every analytics payload once. Called at application startup."""
    logger.info("Analytics: precomputing over %s rows", f"{len(df):,}")
    analytics = Analytics(
        summary=get_summary_stats(df),
        category_distribution=get_category_distribution(df),
        volume_by_event=get_volume_by_event(df),
        volume_by_genre=get_volume_by_genre(df),
        event_category_mix=get_event_category_mix(df),
        genre_event_matrix=get_genre_event_matrix(df),
        cooccurrence=get_cooccurrence(df),
        needs_bundles=get_needs_bundles(df),
        message_length=get_message_length(df),
        top_terms=get_top_terms(df),
        urgent_terms=get_urgent_terms(df),
        data_quality=get_data_quality(df),
        events=[e for e in EVENTS],
        categories=category_columns(df),
    )
    logger.info("Analytics: ready")
    return analytics


def iter_payload_names() -> Iterable[str]:
    """Names of the cached payloads, used by the health endpoint."""
    return Analytics().__dict__.keys()
