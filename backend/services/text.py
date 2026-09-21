"""Shared text utilities: stopwords and tokenisation.

Kept in its own module so both the analytics service and the model explainer
use the same vocabulary rules.
"""

from __future__ import annotations

import re

TOKEN_RE = re.compile(r"[a-z][a-z'\-]{2,}")

STOPWORDS: frozenset[str] = frozenset(
    """
    the and for are but not you all any can had her was one our out has him his she
    with this that have from they been what were will would there their which
    about into over under more most some such only other than then them these those
    your just like also very much many make made need needs needed get got give
    please help thanks thank say says said told tell now new per via said also
    who whom whose how why when where while does did done being here does doesn
    people area areas around because before after both each few him himself
    ourselves itself myself yourself between during against above below off own same
    too may might must shall should could would still yet ever never always
    http https www com org rss href amp nbsp
    """.split()
)


def tokens(text: str) -> list[str]:
    """Lowercase content words, stopwords removed."""
    return [t for t in TOKEN_RE.findall(text.lower()) if t not in STOPWORDS]


def is_informative(term: str) -> bool:
    """True when a term reads as an explanation on its own.

    A single word must carry meaning; a phrase must also start and end with a
    meaningful word, so "injured and" and "are trapped" are rejected while
    "trapped under rubble" is kept.
    """
    words = [w for w in re.split(r"\s+", term.lower().strip()) if w]
    if not words:
        return False
    if not any(w not in STOPWORDS and len(w) > 2 for w in words):
        return False
    if len(words) > 1 and (words[0] in STOPWORDS or words[-1] in STOPWORDS):
        return False
    return True
