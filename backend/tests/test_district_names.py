"""Name matching across IFI, the census and geoBoundaries (``backend/district_names.py``)."""

from __future__ import annotations

import pandas as pd
import pytest

from backend.district_names import DistrictIndex, canon_state, compact, norm, split_districts, split_states

GEO = pd.DataFrame({
    "state": ["Karnataka", "Karnataka", "Karnataka", "Kerala", "Kerala", "Assam", "Assam", "Assam", "Telangana",
              "Andhra Pradesh", "Chhattisgarh", "Himachal Pradesh", "Sikkim", "Uttar Pradesh"],
    "name": ["Bangalore", "Bangalore Rural", "Bijapur", "Kollam", "Kozhikode", "Karbi Anglong East",
             "Karbi Anglong West", "Kamrup Metropolitan", "Hydrabad", "Kadapa(YSR)", "Bijapur", "Bilaspur",
             "East District", "Kanpur Nagar"],
})
ALIASES = pd.DataFrame([
    ("ifi", "Bengaluru Urban", "Karnataka", "Bangalore"),
    ("ifi", "Bengaluru Rural", "Karnataka", "Bangalore Rural"),
    ("ifi", "Vijayapura", "Karnataka", "Bijapur"),
    ("ifi", "Karbi Anglong", "Assam", "Karbi Anglong East"),
    ("ifi", "Karbi Anglong", "Assam", "Karbi Anglong West"),
    ("ifi", "Muzaffarabad", "Kerala", "-"),
    ("ifi", "Kochi", "Kerala", "~"),
    ("ifi", "Gangtok", "Sikkim", "East District"),
], columns=["source", "name", "geo_state", "geo_name"])


@pytest.fixture(scope="module")
def index() -> DistrictIndex:
    return DistrictIndex(GEO, ALIASES)


def test_spelling_is_normalised() -> None:
    assert norm("Purba Purba Medinipur") == "purba medinipur"      # IFI repeats words
    assert norm("Kaimur (Bhabua)") == "kaimur"
    assert compact("S.A.S Nagar*") == "sasnagar"
    assert canon_state("ORISSA") == "odisha" and canon_state("NCT OF DELHI") == "delhi"


def test_lists_are_split() -> None:
    assert split_districts("Kollam, Kozhikode; Idukki and Wayanad") == ["Kollam", "Kozhikode", "Idukki", "Wayanad"]
    assert split_states("Jammu and Kashmir, Punjab") == ["Jammu and Kashmir", "Punjab"]


def test_exact_and_alias_matches_stay_inside_the_state(index: DistrictIndex) -> None:
    assert index.find("ifi", "Kollam", ["Kerala"]).key == ("Kerala", "Kollam")
    assert index.find("ifi", "Bengaluru Urban", ["Karnataka"]).key == ("Karnataka", "Bangalore")
    # The Karnataka Bijapur, not the Chhattisgarh one, because the event lists Karnataka.
    assert index.find("ifi", "Vijayapura", ["Karnataka"]).key == ("Karnataka", "Bijapur")
    assert index.find("ifi", "Bijapur", ["Chhattisgarh"]).key == ("Chhattisgarh", "Bijapur")


def test_an_alias_can_stand_for_two_districts(index: DistrictIndex) -> None:
    match = index.find("ifi", "Karbi Anglong", ["Assam"])
    assert match.how == "alias" and len(match.keys) == 2 and match.key is None
    assert index.find("census", "Karbi Anglong", ["Assam"]).key is None      # census never inherits an IFI alias


def test_telangana_names_are_found_under_andhra_pradesh() -> None:
    """The census files Hyderabad under Andhra Pradesh; the polygons say Telangana."""
    match = DistrictIndex(GEO, ALIASES).find("census", "Hyderabad", ["ANDHRA PRADESH"])
    assert match.key == ("Telangana", "Hydrabad") and match.how == "fuzzy"


def test_ambiguous_names_are_never_guessed(index: DistrictIndex) -> None:
    """Two states have a Bijapur: outside either state's list the name is left unmatched."""
    assert index.find("ifi", "Bijapur", ["Kerala"]).how == "none"
    assert index.find("ifi", "Bijapur", []).how == "none"


def test_national_fallback_needs_a_unique_name(index: DistrictIndex) -> None:
    """IFI's State field is often incomplete: a name used by one district nationwide is still matched."""
    match = index.find("ifi", "Kollam", ["Karnataka"])
    assert match.how == "national" and match.key == ("Kerala", "Kollam")
    assert index.find("census", "Kollam", ["Karnataka"]).how == "none"


def test_missing_commas_and_prose(index: DistrictIndex) -> None:
    both = index.find("ifi", "Kollam Kozhikode", ["Kerala"])
    assert both.how == "split" and both.keys == [("Kerala", "Kollam"), ("Kerala", "Kozhikode")]
    assert index.find("ifi", "Parts of Kerala", ["Kerala"]).how == "description"
    assert index.find("ifi", "14 districts", ["Kerala"]).how == "description"
    assert index.find("ifi", "Kochi", ["Kerala"]).how == "description"        # a city, marked "~"
    assert index.find("ifi", "Muzaffarabad", ["Kerala"]).how == "no_polygon"  # a real district, no polygon


def test_an_alias_to_a_missing_district_is_an_error() -> None:
    bad = pd.DataFrame([("ifi", "Nowhere", "Kerala", "Atlantis")], columns=ALIASES.columns)
    with pytest.raises(ValueError, match="alias target"):
        DistrictIndex(GEO, bad)
