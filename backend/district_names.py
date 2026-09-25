"""Match district and state names across IFI, the 2011 census and geoBoundaries.

The three sources spell districts differently ("Sri Potti Sriramulu Nellore",
"Nellore"; "Bangalore Urban", "Bengaluru Urban") and draw state borders at
different dates (Telangana is inside Andhra Pradesh in the census). A source
name is matched to a geoBoundaries district only inside its own state, or that
state's parent/child group, in this order:

1. the same name after normalisation (accents, case, punctuation dropped);
2. a manual fix from ``district_aliases.csv``;
3. a close spelling (difflib ratio >= ``FUZZY_CUTOFF``) that is unique in the state.

Nothing else is guessed: a name that fails all three is reported as unmatched.
"""

from __future__ import annotations

import difflib
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

FUZZY_CUTOFF = 0.86

#: Spellings of a state (after ``norm``) -> the geoBoundaries ADM1 name, normalised.
STATE_SPELLINGS = {
    "orissa": "odisha",
    "pondicherry": "puducherry",
    "nct of delhi": "delhi",
    "new delhi": "delhi",
    "jammu and kashmir": "jammu and kashmir",
    "uttaranchal": "uttarakhand",
    "chattisgarh": "chhattisgarh",
    "arunanchal pradesh": "arunachal pradesh",
    "andaman and nicobar": "andaman and nicobar islands",
    "andaman nicobar": "andaman and nicobar islands",
    "dadra and nagar haveli": "dadra and nagar haveli and daman and diu",
    "dadar and nagar haveli": "dadra and nagar haveli and daman and diu",
    "daman and diu": "dadra and nagar haveli and daman and diu",
    "goa daman and diu": "goa",
    "telengana": "telangana",
}

#: States whose borders moved: a name filed under one may sit in the other today.
STATE_GROUPS = [
    {"andhra pradesh", "telangana"},
    {"jammu and kashmir", "ladakh"},
    {"uttar pradesh", "uttarakhand"},
    {"bihar", "jharkhand"},
    {"madhya pradesh", "chhattisgarh"},
    {"goa", "dadra and nagar haveli and daman and diu"},
]


def strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", str(text)) if not unicodedata.combining(c))


def norm(text: str) -> str:
    """Lower case, no accents, "&" as "and", brackets dropped, single spaces."""
    text = strip_accents(text).lower().replace("&", " and ")
    text = re.sub(r"\(.*?\)", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    words = text.split()
    # IFI's generated names repeat words ("Purba Purba Medinipur", "Kanpur nagar Nagar").
    words = [w for i, w in enumerate(words) if i == 0 or w != words[i - 1]]
    return " ".join(words)


def compact(text: str) -> str:
    """``norm`` without spaces, for names that differ only in word breaks."""
    return norm(text).replace(" ", "")


def canon_state(text: str) -> str:
    """Normalised modern state name for any spelling in the sources."""
    key = norm(text)
    return STATE_SPELLINGS.get(key, key)


def state_scope(states: list[str]) -> set[str]:
    """The listed states plus any state they share a moved border with."""
    scope = {canon_state(s) for s in states if s}
    for group in STATE_GROUPS:
        if scope & group:
            scope |= group
    return scope


def split_states(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"[,;]", str(text)) if p.strip()]


def split_districts(text: str) -> list[str]:
    """IFI's free-text district list: comma, semicolon, slash or "and" separated."""
    if text is None or (isinstance(text, float) and pd.isna(text)):
        return []
    parts = re.split(r"[,;/]|\band\b|&", str(text))
    return [p.strip() for p in parts if p.strip()]


#: IFI's "Districts" field sometimes holds prose ("Parts of Sikkim", "14 districts").
DESCRIPTION = re.compile(
    r"^\d|\b(parts?|many|most|some|few|several|various|entire|areas?|regions?|districts of|neighbou?rhood|"
    r"adjoining|northern|southern|central part|bengal|marathwada|heavy|hilly|village|suburbans|ghat|"
    r"cauvery|of the state)\b", re.I)

NO_POLYGON = "-"      # alias target meaning: a real district that geoBoundaries does not draw
NOT_A_DISTRICT = "~"  # alias target meaning: a town, region or state, not a district


@dataclass
class Match:
    keys: list[tuple[str, str]]   # (state, name) of each geoBoundaries district it stands for
    how: str                      # exact | alias | fuzzy | national | no_polygon | description | none

    @property
    def key(self) -> tuple[str, str] | None:
        return self.keys[0] if len(self.keys) == 1 else None


class DistrictIndex:
    """geoBoundaries districts, searchable by (state scope, source name)."""

    def __init__(self, districts: pd.DataFrame, aliases: pd.DataFrame | None = None) -> None:
        self.by_state: dict[str, dict[str, tuple[str, str]]] = {}
        self.by_name: dict[str, list[tuple[str, str]]] = {}
        for row in districts.itertuples():
            state = canon_state(row.state)
            self.by_state.setdefault(state, {})[compact(row.name)] = (row.state, row.name)
            self.by_name.setdefault(compact(row.name), []).append((row.state, row.name))
        self.aliases: dict[tuple[str, str], list] = {}
        if aliases is not None:
            geo = {(canon_state(r.state), compact(r.name)): (r.state, r.name) for r in districts.itertuples()}
            for a in aliases.itertuples():
                if a.geo_name in (NO_POLYGON, NOT_A_DISTRICT):
                    target = a.geo_name
                else:
                    target = geo.get((canon_state(a.geo_state), compact(a.geo_name)))
                    if target is None:
                        raise ValueError(f"alias target not in geoBoundaries: {a.geo_state} / {a.geo_name}")
                self.aliases.setdefault((a.source, compact(a.name)), []).append(target)

    def _alias(self, source: str, key: str, scope: set[str] | None) -> Match | None:
        targets = self.aliases.get((source, key))
        if targets is None:
            return None
        if targets == [NO_POLYGON]:
            return Match([], "no_polygon")
        if targets == [NOT_A_DISTRICT]:
            return Match([], "description")
        if scope is not None and not all(canon_state(t[0]) in scope for t in targets):
            return None
        return Match(list(targets), "alias")

    def find(self, source: str, name: str, states: list[str]) -> Match:
        """Match one source name; see the module docstring for the order tried."""
        match = self._find(source, name, states)
        if match.how != "none" or source != "ifi":
            return match
        # IFI sometimes runs two districts together ("Kollam Kozhikode"): accept a split where both halves match.
        words = str(name).split()
        for cut in range(1, len(words)):
            left = self._find(source, " ".join(words[:cut]), states)
            right = self._find(source, " ".join(words[cut:]), states)
            if left.keys and right.keys and left.how != "fuzzy" and right.how != "fuzzy":
                return Match(left.keys + right.keys, "split")
        return match

    def _find(self, source: str, name: str, states: list[str]) -> Match:
        key = compact(name)
        if not key or (source == "ifi" and DESCRIPTION.search(norm(name))):
            return Match([], "description")
        scope = {s for s in state_scope(states) if s in self.by_state}
        for state in sorted(scope):
            hit = self.by_state[state].get(key)
            if hit:
                return Match([hit], "exact")
        hit = self._alias(source, key, scope)
        if hit:
            return hit
        pool = {k: v for state in scope for k, v in self.by_state[state].items()}
        close = difflib.get_close_matches(key, list(pool), n=2, cutoff=FUZZY_CUTOFF)
        if len(close) == 1 or (len(close) == 2 and
                               difflib.SequenceMatcher(None, key, close[0]).ratio()
                               - difflib.SequenceMatcher(None, key, close[1]).ratio() > 0.05):
            return Match([pool[close[0]]], "fuzzy")
        if source == "ifi":
            # IFI's State field is often incomplete for multi-state events: fall back to a name that is
            # unique in the whole country (never a fuzzy match, never a name shared by two states).
            hit = self._alias(source, key, None)
            if hit:
                return hit
            named = self.by_name.get(key, [])
            if len(named) == 1:
                return Match(list(named), "national")
        return Match([], "none")


def load_aliases(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=["source", "name", "geo_state", "geo_name"])
    return pd.read_csv(path, dtype=str).fillna("")
