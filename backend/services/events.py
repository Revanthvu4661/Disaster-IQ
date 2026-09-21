"""Event inference for Figure-Eight disaster messages.

The raw dataset has no event column. Two signals are combined:

1. keyword rules (place names and event-specific vocabulary), weighted;
2. id-range / genre heuristics, used only when the keywords are silent or tied.
   The corpus is ordered by source, so the id ranges below were derived from
   the distribution of keyword-labelled rows (see docs/DECISIONS.md).

``infer_event`` returns both the label and the method that produced it so that
callers (and the UI) can be honest about how certain a label is.
"""

from __future__ import annotations

import re
from typing import Iterable

import pandas as pd

HAITI = "Haiti earthquake"
CHILE = "Chile earthquake"
PAKISTAN = "Pakistan floods"
SANDY = "Superstorm Sandy"
OTHER = "Other"
EVENTS: list[str] = [HAITI, CHILE, PAKISTAN, SANDY, OTHER]

# (pattern, weight). Strong = place names unique to an event.
_RULES: dict[str, list[tuple[str, int]]] = {
    HAITI: [
        (r"haiti|ayiti|port[- ]au[- ]prince|jacmel|leogane|l[ée]og[âa]ne|carrefour|"
         r"cit[eé] soleil|petionville|p[ée]tion[- ]?ville|cap[- ]ha[iï]tien|croix[- ]des|"
         r"delmas|gona[iï]ves|kenscoff|j[ée]r[ée]mie|hinche|les cayes|ouanaminthe|"
         r"bainet|petit[- ]go[aâ]ve|grand[- ]go[aâ]ve|4636|minustah|creole", 3),
        (r"cholera|january 12|jan(uary)? 12", 1),
    ],
    CHILE: [
        (r"chile|chilean|santiago|concepci[oó]n|talca|maule|valpara[ií]so|bio[- ]?bio|"
         r"chill[aá]n|constituci[oó]n|penco|dichato|talcahuano|pichilemu|curico|"
         r"cauquenes|8\.8|onemi", 3),
    ],
    PAKISTAN: [
        (r"pakistan|punjab|sindh|swat\b|khyber|karachi|indus|nowshera|sukkur|muzaffar|"
         r"balochistan|peshawar|lahore|islamabad|jacobabad|rajanpur|dera ghazi|charsadda|"
         r"kpk|watan|ndma|taluk|vill\b|tehsil", 3),
        (r"monsoon", 1),
    ],
    SANDY: [
        (r"sandy|superstorm|frankenstorm|new york|nyc|manhattan|brooklyn|staten island|"
         r"long island|new jersey|\bnj\b|hoboken|jersey shore|con ?ed|coney island|"
         r"rockaway|queens|bloomberg|christie|atlantic city|lower manhattan|herald sq|"
         r"connecticut|\bny1\b|point pleasant|lga\b|hurricane sandy", 3),
    ],
}
_COMPILED = {ev: [(re.compile(p, re.I), w) for p, w in rules] for ev, rules in _RULES.items()}

# (genre, id_lo, id_hi_exclusive, event). Derived from keyword-labelled rows.
ID_RANGES: list[tuple[str, int, int, str]] = [
    ("direct", 0, 11_600, HAITI),
    ("direct", 11_600, 13_800, SANDY),
    ("direct", 13_800, 15_500, PAKISTAN),
    ("social", 11_000, 12_000, HAITI),
    ("social", 12_000, 13_000, SANDY),
    ("social", 13_000, 14_000, CHILE),
    ("social", 14_000, 16_000, SANDY),
]


def keyword_scores(message: str) -> dict[str, int]:
    """Weighted keyword score per event for a message."""
    text = message or ""
    out: dict[str, int] = {}
    for ev, rules in _COMPILED.items():
        s = sum(w for pat, w in rules if pat.search(text))
        if s:
            out[ev] = s
    return out


def _range_event(genre: str | None, msg_id: int | None) -> str | None:
    if msg_id is None or genre is None:
        return None
    for g, lo, hi, ev in ID_RANGES:
        if genre == g and lo <= msg_id < hi:
            return ev
    return None


def infer_event(message: str, msg_id: int | None = None, genre: str | None = None) -> tuple[str, str]:
    """Infer the disaster event for one message.

    Returns ``(event, method)`` where method is ``keyword``, ``id_range`` or ``default``.
    Free-text messages typed into the UI have no id/genre, so they use keywords only.
    """
    scores = keyword_scores(message)
    if scores:
        best = max(scores.values())
        winners = [e for e, s in scores.items() if s == best]
        if len(winners) == 1:
            return winners[0], "keyword"
        ranged = _range_event(genre, msg_id)
        if ranged in winners:
            return ranged, "id_range"
        return winners[0], "keyword"
    ranged = _range_event(genre, msg_id)
    if ranged:
        return ranged, "id_range"
    return OTHER, "default"


def infer_events(df: pd.DataFrame) -> pd.DataFrame:
    """Vectorised-ish wrapper: returns DataFrame with ``event`` and ``event_method``."""
    res = [infer_event(m, i, g) for m, i, g in zip(df["message"], df["id"], df["genre"])]
    return pd.DataFrame(res, columns=["event", "event_method"], index=df.index)


def event_from_text_only(message: str) -> str:
    """Event for a free-text message (no id/genre): keyword only, else Other."""
    return infer_event(message)[0]


def event_names() -> Iterable[str]:
    return list(EVENTS)
