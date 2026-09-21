"""ETL parsing, the related=2 flag, and event inference."""

from __future__ import annotations

import pandas as pd
import pytest

from backend.etl import (
    CATEGORY_NAMES,
    category_columns,
    need_columns,
    parse_categories,
    relevant,
)
from backend.services import events as ev


# ── category parsing ─────────────────────────────────────────────────────────


def test_parse_categories_basic() -> None:
    series = pd.Series(["related-1;request-0;water-1", "related-0;request-1;water-0"])
    out = parse_categories(series)
    assert list(out.columns) == ["related", "request", "water", "is_irrelevant"]
    assert out["water"].tolist() == [1, 0]
    assert out["is_irrelevant"].tolist() == [0, 0]


def test_related_two_sets_irrelevant_flag_not_one() -> None:
    """related=2 means 'not disaster related', so it must not be clipped to 1."""
    out = parse_categories(pd.Series(["related-2;request-0;water-0"]))
    assert out["is_irrelevant"].tolist() == [1]
    assert out["related"].tolist() == [0]


def test_multi_digit_values_are_parsed_from_the_suffix() -> None:
    out = parse_categories(pd.Series(["related-1;child_alone-0;other_aid-1"]))
    assert out["other_aid"].tolist() == [1]


def test_relevant_excludes_irrelevant_rows(sample_frame: pd.DataFrame) -> None:
    assert len(relevant(sample_frame)) == 2


def test_category_helpers(sample_frame: pd.DataFrame) -> None:
    cats = category_columns(sample_frame)
    assert "water" in cats and "is_irrelevant" not in cats
    needs = need_columns(sample_frame)
    assert "related" not in needs and "request" not in needs and "water" in needs


def test_canonical_names_count() -> None:
    assert len(CATEGORY_NAMES) == 36


# ── event inference ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("Earthquake damage in Port-au-Prince, Haiti", ev.HAITI),
        ("Concepcion and Talca need help after the quake in Chile", ev.CHILE),
        ("Floods in Sindh and Punjab, Pakistan", ev.PAKISTAN),
        ("Hurricane Sandy flooded lower Manhattan", ev.SANDY),
        ("A quiet day with nothing to report", ev.OTHER),
    ],
)
def test_keyword_inference(message: str, expected: str) -> None:
    event, method = ev.infer_event(message)
    assert event == expected
    assert method == ("keyword" if expected != ev.OTHER else "default")


def test_id_range_used_when_keywords_are_silent() -> None:
    event, method = ev.infer_event("We need help urgently", msg_id=5000, genre="direct")
    assert event == ev.HAITI
    assert method == "id_range"


def test_keyword_beats_id_range() -> None:
    event, method = ev.infer_event(
        "Flooding across Sindh province", msg_id=5000, genre="direct"
    )
    assert event == ev.PAKISTAN
    assert method == "keyword"


def test_news_without_keywords_stays_other() -> None:
    event, method = ev.infer_event("Officials met to discuss aid", msg_id=20000, genre="news")
    assert event == ev.OTHER
    assert method == "default"


def test_tie_is_broken_by_id_range() -> None:
    message = "Haiti and Pakistan both reported flooding"
    event, method = ev.infer_event(message, msg_id=14500, genre="direct")
    assert event in {ev.HAITI, ev.PAKISTAN}
    assert method in {"id_range", "keyword"}


def test_text_only_helper() -> None:
    assert ev.event_from_text_only("Boats needed in Nowshera") == ev.PAKISTAN


def test_infer_events_frame(sample_frame: pd.DataFrame) -> None:
    out = ev.infer_events(sample_frame)
    assert list(out.columns) == ["event", "event_method"]
    assert out["event"].tolist()[0] == ev.HAITI


def test_corpus_has_events_and_flags(df: pd.DataFrame) -> None:
    """The persisted corpus carries the derived columns the API depends on."""
    for column in ("event", "event_method", "is_irrelevant", "message_length"):
        assert column in df.columns
    assert df["is_irrelevant"].sum() > 0
    assert set(df["event"]).issubset(set(ev.EVENTS))
    # Every event inferred by keyword or range must be a real event, not Other.
    assigned = df[df["event_method"] != "default"]
    assert (assigned["event"] != ev.OTHER).all()
