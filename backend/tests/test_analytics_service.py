"""Analytics service: shapes, invariants and the co-occurrence matrix."""

from __future__ import annotations

import numpy as np
import pandas as pd

from backend.services.analytics import (
    build_analytics,
    get_category_distribution,
    get_cooccurrence,
    get_data_quality,
    get_needs_bundles,
    get_summary_stats,
    get_volume_by_event,
    keyword_in_context,
)
from backend.services.events import EVENTS


def test_distribution_is_sorted_and_flagged(df: pd.DataFrame) -> None:
    rows = get_category_distribution(df)
    counts = [r["count"] for r in rows]
    assert counts == sorted(counts, reverse=True)
    assert any(r["is_urgent"] for r in rows)
    assert all(0 <= r["share"] <= 1 for r in rows)


def test_distribution_excludes_irrelevant_rows(sample_frame: pd.DataFrame) -> None:
    rows = {r["category"]: r["count"] for r in get_category_distribution(sample_frame)}
    assert rows["water"] == 1
    assert rows["related"] == 2  # the irrelevant row is not counted


def test_volume_by_event_covers_known_events(df: pd.DataFrame) -> None:
    rows = get_volume_by_event(df)
    assert {r["event"] for r in rows}.issubset(set(EVENTS))
    for row in rows:
        assert row["count"] == (
            row["keyword_inferred"] + row["range_inferred"] + row["unassigned"]
        )


def test_cooccurrence_matrix_is_symmetric_with_counts_on_the_diagonal(
    df: pd.DataFrame,
) -> None:
    payload = get_cooccurrence(df)
    counts = np.array(payload["counts"])
    assert (counts == counts.T).all()
    assert counts.diagonal().tolist() == payload["totals"]
    jaccard = np.array(payload["jaccard"])
    assert jaccard.max() <= 1.0 and jaccard.min() >= 0.0


def test_cooccurrence_pairs_match_the_matrix(df: pd.DataFrame) -> None:
    payload = get_cooccurrence(df)
    cats = payload["categories"]
    counts = np.array(payload["counts"])
    top = payload["top_pairs"][0]
    i, j = cats.index(top["cat_a"]), cats.index(top["cat_b"])
    assert counts[i, j] == top["count"]


def test_needs_bundles_are_sorted_and_multi_label(df: pd.DataFrame) -> None:
    bundles = get_needs_bundles(df, top_n=8)
    assert all(b["size"] >= 2 for b in bundles)
    counts = [b["count"] for b in bundles]
    assert counts == sorted(counts, reverse=True)


def test_summary_stats_are_consistent(df: pd.DataFrame) -> None:
    stats = get_summary_stats(df)
    assert stats["total_messages"] == len(df)
    assert stats["analysed_messages"] == len(df) - stats["irrelevant_messages"]
    assert 0 <= stats["urgent_share"] <= 1
    assert len(stats["sparklines"]["urgent_share"]) == 12
    assert stats["most_requested_need"] not in {"related", "request", "aid_related"}


def test_data_quality_reports_noise_and_imbalance(df: pd.DataFrame) -> None:
    quality = get_data_quality(df)
    assert quality["irrelevant_count"] > 0
    assert quality["imbalance_ratio"] > 1
    assert quality["rows"] == len(df)
    assert any(label["category"] == "child_alone" for label in quality["empty_labels"])


def test_keyword_in_context_finds_matches(df: pd.DataFrame) -> None:
    payload = keyword_in_context(df, "water", limit=5)
    assert payload["total"] > 0
    assert len(payload["results"]) <= 5
    for result in payload["results"]:
        assert "water" in result["match"].lower()


def test_keyword_in_context_filters(df: pd.DataFrame) -> None:
    filtered = keyword_in_context(df, "water", limit=5, category="water")
    unfiltered = keyword_in_context(df, "water", limit=5)
    assert filtered["total"] <= unfiltered["total"]


def test_keyword_in_context_empty_query(df: pd.DataFrame) -> None:
    assert keyword_in_context(df, "   ")["total"] == 0


def test_build_analytics_fills_every_payload(analytics) -> None:
    assert analytics.summary and analytics.category_distribution
    assert analytics.cooccurrence["categories"]
    assert analytics.top_terms["water"], "water should have distinctive terms"
    assert analytics.urgent_terms
    assert analytics.message_length["bins"]
    assert analytics.genre_event_matrix["values"]


def test_top_terms_skip_rare_labels(analytics) -> None:
    """child_alone has no positives, so it must produce no terms."""
    assert analytics.top_terms.get("child_alone") == []


def test_build_analytics_on_small_frame(sample_frame: pd.DataFrame) -> None:
    small = build_analytics(sample_frame)
    assert small.summary["total_messages"] == 3
