"""Analytics endpoints. Everything is served from the startup cache."""

from __future__ import annotations

from fastapi import APIRouter, Query

from backend import schemas
from backend.services.analytics import keyword_in_context
from backend.state import state

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/summary-stats", response_model=schemas.SummaryStats)
def summary_stats() -> dict:
    """KPI block: totals, urgency share, most requested need, sparklines."""
    return state.require_analytics().summary


@router.get("/category-distribution", response_model=list[schemas.CategoryCount])
def category_distribution() -> list[dict]:
    """Message count per category, sorted descending."""
    return state.require_analytics().category_distribution


@router.get("/top-categories", response_model=list[schemas.CategoryCount])
def top_categories(
    limit: int = Query(15, ge=1, le=36),
    needs_only: bool = Query(False, description="Exclude meta labels such as related"),
) -> list[dict]:
    """Top N categories for the distribution chart."""
    rows = state.require_analytics().category_distribution
    if needs_only:
        rows = [r for r in rows if r["is_need"]]
    return rows[:limit]


@router.get("/volume-by-event", response_model=list[schemas.EventVolume])
def volume_by_event() -> list[dict]:
    """Message volume per inferred disaster event, with inference provenance."""
    return state.require_analytics().volume_by_event


@router.get("/volume-by-genre", response_model=list[schemas.GenreVolume])
def volume_by_genre() -> list[dict]:
    """Message volume per source genre (direct, news, social)."""
    return state.require_analytics().volume_by_genre


@router.get("/event-category-mix", response_model=schemas.EventCategoryMix)
def event_category_mix() -> dict:
    """Need-category mix per event, as shares, for the comparison chart."""
    return state.require_analytics().event_category_mix


@router.get("/genre-event-matrix", response_model=schemas.GenreEventMatrix)
def genre_event_matrix() -> dict:
    """Counts per genre and event for the heatmap."""
    return state.require_analytics().genre_event_matrix


@router.get("/category-cooccurrence", response_model=schemas.CooccurrenceMatrix)
def category_cooccurrence() -> dict:
    """Full co-occurrence matrix (counts and Jaccard) plus the top pairs."""
    return state.require_analytics().cooccurrence


@router.get("/needs-bundles", response_model=list[schemas.NeedsBundle])
def needs_bundles(limit: int = Query(12, ge=1, le=40)) -> list[dict]:
    """Most frequent combinations of need categories."""
    return state.require_analytics().needs_bundles[:limit]


@router.get("/message-length", response_model=schemas.MessageLength)
def message_length() -> dict:
    """Message-length histogram and per-genre medians."""
    return state.require_analytics().message_length


@router.get("/top-terms/{category}", response_model=list[schemas.TermRow])
def top_terms(category: str, limit: int = Query(15, ge=1, le=50)) -> list[dict]:
    """Distinctive unigrams and bigrams for one category."""
    return state.require_analytics().top_terms.get(category, [])[:limit]


@router.get("/urgent-terms", response_model=list[schemas.TermRow])
def urgent_terms(limit: int = Query(40, ge=1, le=100)) -> list[dict]:
    """Ranked terms in messages carrying at least one severity-weighted label."""
    rows = state.require_analytics().urgent_terms[:limit]
    return [{**r, "share": None, "score": None} for r in rows]


@router.get("/data-quality", response_model=schemas.DataQuality)
def data_quality() -> dict:
    """Duplicates, noise share, label imbalance and other data-quality facts."""
    return state.require_analytics().data_quality


@router.get("/search", response_model=schemas.KwicResponse)
def search(
    q: str = Query(min_length=2, max_length=80),
    limit: int = Query(25, ge=1, le=100),
    category: str | None = None,
    event: str | None = None,
) -> dict:
    """Keyword-in-context search over the corpus."""
    return keyword_in_context(
        state.require_df(), q, limit=limit, category=category, event=event
    )
