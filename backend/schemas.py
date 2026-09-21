"""Pydantic response and request models for the DisasterIQ API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

Urgency = Literal["immediate", "within_6h", "within_24h"]
SeverityLevel = Literal["low", "medium", "high", "critical"]


# ── shared ────────────────────────────────────────────────────────────────────


class HealthResponse(BaseModel):
    status: str
    service: str = "DisasterIQ API"
    version: str
    model_loaded: bool
    analytics_ready: bool
    rows: int | None = None


class CategoryPrediction(BaseModel):
    category: str
    confidence: float = Field(ge=0.0, le=1.0)
    threshold: float
    triggered: bool


class SeverityContributor(BaseModel):
    category: str
    probability: float
    weight: float
    contribution: float


class SeverityInfo(BaseModel):
    score: float = Field(ge=0.0, le=100.0)
    level: SeverityLevel
    contributors: list[SeverityContributor] = []


class ExplanationTerm(BaseModel):
    term: str
    contribution: float


class HighlightSpan(BaseModel):
    start: int
    end: int
    text: str
    category: str
    contribution: float


class LanguageInfo(BaseModel):
    code: str
    name: str
    confidence: float
    is_english: bool
    detector: str


class TranslationInfo(BaseModel):
    text: str | None = None
    translated: bool = False
    backend: str | None = None
    error: str | None = None


# ── recommendations ───────────────────────────────────────────────────────────


class RecommendedAction(BaseModel):
    id: str
    action: str
    agency: str
    agency_key: str
    resources: list[str]
    urgency: Urgency
    urgency_label: str
    rationale: str
    category: str | None = None
    probability: float | None = None
    priority: float
    source: Literal["category", "severity", "event"]


class ResourcePriority(BaseModel):
    resource: str
    score: float


class RecommendationPlan(BaseModel):
    actions: list[RecommendedAction]
    severity_level: SeverityLevel
    severity_score: float
    event: str | None
    agencies: list[str]
    immediate_count: int
    resource_priorities: list[ResourcePriority]
    rules_version: int


class RecommendRequest(BaseModel):
    message: str | None = Field(
        default=None, max_length=4000,
        description="Message to classify before recommending. Omit when sending probabilities.",
    )
    probabilities: dict[str, float] | None = Field(
        default=None, description="Category probabilities, when already predicted."
    )
    severity_score: float | None = Field(default=None, ge=0, le=100)
    severity_level: SeverityLevel | None = None
    event: str | None = None
    triggered: list[str] | None = None

    @field_validator("message")
    @classmethod
    def _strip(cls, value: str | None) -> str | None:
        return value.strip() if value else value


# ── prediction ────────────────────────────────────────────────────────────────


class PredictRequest(BaseModel):
    message: str = Field(
        min_length=3, max_length=4000,
        examples=["People need food and water urgently after the earthquake"],
    )
    explain: bool = True
    recommend: bool = True
    translate: bool = True

    @field_validator("message")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 3:
            raise ValueError("message must contain at least 3 non-space characters")
        return cleaned


class PredictResponse(BaseModel):
    message: str
    classified_text: str
    predictions: list[CategoryPrediction]
    triggered_categories: list[str]
    triggered_count: int
    severity: SeverityInfo
    event: str
    explanations: dict[str, list[ExplanationTerm]] = {}
    highlights: list[HighlightSpan] = []
    language: LanguageInfo | None = None
    translation: TranslationInfo | None = None
    recommendation: RecommendationPlan | None = None
    incident_summary: str
    model_name: str
    model_macro_f1: float


class BatchPredictRequest(BaseModel):
    messages: list[str] = Field(min_length=1, max_length=500)
    explain: bool = False
    recommend: bool = True

    @field_validator("messages")
    @classmethod
    def _clean(cls, values: list[str]) -> list[str]:
        cleaned = [v.strip() for v in values if v and v.strip()]
        if not cleaned:
            raise ValueError("no non-empty messages provided")
        return cleaned


class BatchItem(BaseModel):
    index: int
    message: str
    severity: SeverityInfo
    event: str
    triggered_categories: list[str]
    top_category: str | None
    top_confidence: float
    recommendation: RecommendationPlan | None = None
    language: LanguageInfo | None = None


class ResourceDemandRow(BaseModel):
    resource: str
    requests: int
    priority_score: float


class AgencyLoad(BaseModel):
    agency: str
    actions: int


class UrgencyCount(BaseModel):
    urgency: str
    label: str
    count: int


class NeedCount(BaseModel):
    category: str
    messages: int


class ResourceForecast(BaseModel):
    messages: int
    resources: list[ResourceDemandRow]
    agencies: list[AgencyLoad]
    urgency: list[UrgencyCount]
    needs: list[NeedCount]


class BatchPredictResponse(BaseModel):
    count: int
    items: list[BatchItem]
    severity_breakdown: dict[str, int]
    event_breakdown: dict[str, int]
    forecast: ResourceForecast
    top_urgent: list[BatchItem]
    skipped: int = 0
    elapsed_ms: float


# ── analytics ─────────────────────────────────────────────────────────────────


class CategoryCount(BaseModel):
    category: str
    count: int
    share: float
    is_need: bool
    is_urgent: bool


class EventVolume(BaseModel):
    event: str
    count: int
    keyword_inferred: int
    range_inferred: int
    unassigned: int


class GenreVolume(BaseModel):
    genre: str
    count: int
    share: float


class SummaryStats(BaseModel):
    total_messages: int
    analysed_messages: int
    total_categories: int
    top_categories: list[str]
    genre_breakdown: dict[str, int]
    event_breakdown: dict[str, int]
    urgent_messages: int
    urgent_share: float
    most_requested_need: str | None
    most_requested_need_count: int
    irrelevant_messages: int
    irrelevant_share: float
    avg_categories_per_message: float
    sparklines: dict[str, list[float]]
    deltas: dict[str, float]
    sparkline_note: str


class EventCategoryMix(BaseModel):
    categories: list[str]
    rows: list[dict[str, Any]]


class GenreEventMatrix(BaseModel):
    genres: list[str]
    events: list[str]
    values: list[list[int]]


class CooccurrencePair(BaseModel):
    cat_a: str
    cat_b: str
    count: int
    jaccard: float


class CooccurrenceMatrix(BaseModel):
    categories: list[str]
    counts: list[list[int]]
    jaccard: list[list[float]]
    totals: list[int]
    top_pairs: list[CooccurrencePair]


class NeedsBundle(BaseModel):
    categories: list[str]
    size: int
    count: int
    share: float


class LengthBin(BaseModel):
    start: int
    end: int
    count: int


class GenreMedian(BaseModel):
    genre: str
    median: int


class MessageLength(BaseModel):
    bins: list[LengthBin]
    median: int
    mean: float
    p95: int
    by_genre: list[GenreMedian]
    short_messages: int


class TermRow(BaseModel):
    term: str
    count: int
    share: float | None = None
    lift: float
    score: float | None = None


class DataQuality(BaseModel):
    raw_rows: int
    rows: int
    duplicates_removed: int
    irrelevant_count: int
    irrelevant_share: float
    empty_labels: list[dict[str, Any]]
    rarest_labels: list[dict[str, Any]]
    short_messages: int
    non_english_share: float
    imbalance_ratio: float
    events_unassigned_share: float


class KwicResult(BaseModel):
    id: int
    before: str
    match: str
    after: str
    genre: str
    event: str


class KwicResponse(BaseModel):
    query: str
    total: int
    results: list[KwicResult]


# ── model ─────────────────────────────────────────────────────────────────────


class LabelMetrics(BaseModel):
    category: str
    precision: float
    recall: float
    f1: float
    support: int
    pr_auc: float
    threshold: float


class CandidateComparison(BaseModel):
    name: str
    test_macro_f1: float
    test_micro_f1: float
    test_weighted_f1: float
    test_macro_pr_auc: float
    test_exact_match: float
    macro_f1_at_0_5: float
    validation_macro_f1: float
    fit_seconds: float
    predict_ms_per_message: float


class ModelPerformance(BaseModel):
    model_name: str
    trained_at: str | None
    split: dict[str, int]
    macro_f1: float
    micro_f1: float
    weighted_f1: float
    samples_f1: float
    macro_pr_auc: float
    exact_match: float
    hamming_accuracy: float
    per_label: list[LabelMetrics]
    comparison: list[CandidateComparison]
    metrics_at_default_threshold: dict[str, Any]


class LabelCurves(BaseModel):
    category: str
    available: bool
    threshold: float | None = None
    pr_curve: dict[str, Any] | None = None
    f1_by_threshold: list[dict[str, float]] | None = None
    support: int | None = None


class GlobalTerms(BaseModel):
    category: str
    terms: list[dict[str, Any]]


# ── hazards ───────────────────────────────────────────────────────────────────


class Hazard(BaseModel):
    source: str
    id: str
    title: str
    category: str
    latitude: float | None
    longitude: float | None
    time: str | None
    severity: str | None
    magnitude: float | None = None
    url: str | None
    in_india: bool


class HazardSource(BaseModel):
    source: str
    status: str
    count: int
    description: str
    error: str | None = None


class HazardsResponse(BaseModel):
    hazards: list[Hazard]
    sources: list[HazardSource]
    fetched_at: str | None
    online: bool
    cached: bool
    age_seconds: int
    india_count: int = 0
