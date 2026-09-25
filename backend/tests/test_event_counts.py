"""Event frequency by year, month and day (``backend/services/event_counts.py``).

Runs on the committed CSVs; no network.
"""

from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.config import DATA_DIR
from backend.services import event_counts as ec

CLEAN = DATA_DIR / "clean"


@pytest.fixture(scope="module")
def counts(client: TestClient) -> dict:
    return {t: client.get(f"/api/disasters/{t}").json()["event_counts"] for t in ("earthquake", "flood", "cyclone")}


@pytest.fixture(scope="module")
def quakes() -> pd.DataFrame:
    return pd.read_csv(CLEAN / "earthquakes_usgs.csv")


@pytest.fixture(scope="module")
def storms() -> pd.DataFrame:
    return pd.read_csv(CLEAN / "cyclones_ibtracs.csv")


def _series(block: dict, series_id: str) -> dict:
    return next(s for s in block["yearly"]["series"] if s["id"] == series_id)


# ── counts agree with the source files ──────────────────────────────────────


def test_earthquake_counts_sum_to_the_usgs_file(counts, quakes) -> None:
    physical = _series(counts["earthquake"], "physical")
    assert physical["n_events"] == len(quakes) == sum(r["count"] for r in physical["rows"])
    assert {r["year"]: r["count"] for r in physical["rows"]} == quakes.groupby("year").size().to_dict() | {
        y: 0 for y in range(physical["first_year"], physical["last_year"] + 1) if y not in set(quakes["year"])}
    monthly, daily = counts["earthquake"]["monthly"], counts["earthquake"]["daily"]
    assert monthly["n_events"] == daily["n_events"] == len(quakes)
    assert sum(sum(row) for row in monthly["matrix"]) == len(quakes)
    assert sum(c for days in daily["by_year"].values() for _, c in days) == len(quakes)
    assert sum(daily["day_of_year"]) == len(quakes)
    assert len(daily["day_of_year"]) == 366


def test_emdat_yearly_counts_sum_to_the_world_file(counts) -> None:
    world = pd.read_csv(CLEAN / "world_yearly.csv")
    for type_id in ("earthquake", "flood", "cyclone"):
        emdat = _series(counts[type_id], "emdat")
        assert emdat["n_events"] == int(world[world["type"] == type_id]["n_events"].sum())
        assert emdat["poor_before"] == 1980


def test_busiest_earthquake_day_is_tohoku(counts, quakes) -> None:
    per_day = quakes["time"].str[:10].value_counts()
    assert per_day.index[0] == "2011-03-11"
    busiest = counts["earthquake"]["daily"]["busiest_day"]
    assert busiest["date"] == "2011-03-11" and busiest["count"] == int(per_day.iloc[0])
    assert busiest["events"][0].startswith("M9.1") and busiest["more"] == busiest["count"] - len(busiest["events"])
    assert counts["earthquake"]["monthly"]["busiest_month_on_record"]["label"] == "Mar 2011"


def test_declustering_removes_aftershock_inflation(counts) -> None:
    daily = counts["earthquake"]["daily"]
    thinned = daily["declustered"]
    assert thinned["n_events"] < daily["n_events"]
    assert thinned["busiest_day"]["count"] < daily["busiest_day"]["count"] / 4
    assert "aftershock" in thinned["why"].lower() and "5-degree" in thinned["method"]
    assert counts["cyclone"]["daily"]["declustered"] is None


def test_cyclones_have_no_events_before_1980(counts, storms) -> None:
    assert storms["genesis_date"].min() >= "1980-01-01"
    physical = _series(counts["cyclone"], "physical")
    assert physical["first_year"] == 1980
    assert counts["cyclone"]["monthly"]["first_year"] == counts["cyclone"]["daily"]["first_year"] == 1980
    assert not any(y < 1980 for y in map(int, counts["cyclone"]["daily"]["by_year"]))


def test_an_unfinished_final_season_is_left_out(counts, storms) -> None:
    """IBTrACS ends on 24 October 2025 with 35 storms for the year: counting it would understate 2025."""
    assert storms["genesis_date"].max() < "2025-12-01"
    physical = _series(counts["cyclone"], "physical")
    assert physical["last_year"] == 2024
    assert physical["n_events"] == int((storms["year"] <= 2024).sum())
    assert counts["cyclone"]["monthly"]["last_year"] == counts["cyclone"]["daily"]["last_year"] == 2024
    assert "2025 is left out" in counts["cyclone"]["yearly"]["note"]


def test_flood_months_and_days_are_india_only(counts) -> None:
    ifi = pd.read_csv(CLEAN / "flood" / "ifi_event_dates.csv")
    monthly, daily = counts["flood"]["monthly"], counts["flood"]["daily"]
    assert monthly["scope"] == daily["scope"] == "India only"
    assert monthly["source"]["id"] == "ifi"
    assert monthly["n_events"] == daily["n_events"] == len(ifi) == ifi["uei"].nunique()
    assert monthly["first_year"] == 1967 and monthly["last_year"] == 2023
    assert [s["id"] for s in counts["flood"]["yearly"]["series"]] == ["emdat"]   # worldwide yearly, EM-DAT only
    assert "no trend is claimed" in monthly["note"]


def test_monthly_and_daily_statistics_are_consistent(counts) -> None:
    for type_id, block in counts.items():
        monthly, daily = block["monthly"], block["daily"]
        years = monthly["last_year"] - monthly["first_year"] + 1
        assert len(monthly["matrix"]) == years and all(len(row) == 12 for row in monthly["matrix"])
        best = monthly["busiest_month_on_record"]
        assert monthly["matrix"][best["year"] - monthly["first_year"]][best["month"] - 1] == best["count"]
        assert best["count"] == max(max(row) for row in monthly["matrix"])
        assert daily["average_per_day"] == pytest.approx(daily["n_events"] / daily["period_days"], abs=1e-4)
        assert 0 < daily["share_days_with_event"] <= 1
        assert daily["days_with_event"] == sum(len(days) for days in daily["by_year"].values())
        assert daily["default_year"] == daily["last_year"]
        for block_name in ("yearly", "monthly", "daily"):
            assert block[block_name]["available"] and block[block_name]["source"], (type_id, block_name)


def test_trend_is_from_1980(counts) -> None:
    trend = _series(counts["earthquake"], "physical")["trend"]
    assert trend["from"] == 1980 and trend["direction"] in {"increasing", "decreasing", "no clear trend"}


# ── helpers and the optional full EM-DAT export ─────────────────────────────


def test_last_year_is_dropped_only_when_it_stops_before_december() -> None:
    early = pd.Series(pd.to_datetime(["2024-05-01", "2025-10-24"]))
    late = pd.Series(pd.to_datetime(["2024-05-01", "2025-12-30"]))
    assert ec.complete_through(early, 2025) == 2024
    assert ec.complete_through(late, 2025) == 2025


def test_full_emdat_export_replaces_the_month_and_day_sources_and_reports_drops() -> None:
    frame = pd.DataFrame({
        "Disaster Type": ["Flood"] * 5 + ["Earthquake"],
        "Start Year": [2000, 2000, 2001, 2001, 2001, 2001],
        "Start Month": [1, 2, 2, None, 3, 3],
        "Start Day": [5, None, 10, 4, 10, 10],
        "Country": ["A", "B", "C", "D", "E", "F"],
        "Total Deaths": [1, 2, 3, 4, 5, 6],
    })
    dated = ec.emdat_events(frame, "flood")
    assert dated["records"] == 5
    assert len(dated["monthly"]) == 4 and dated["dropped_monthly"] == 1     # one record has no start month
    assert len(dated["daily"]) == 3 and dated["dropped_daily"] == 2         # no start month or no start day
    world = pd.DataFrame({"type": ["flood"], "year": [2000], "n_events": [2]})
    block = ec.build("flood", world=world, quakes=None, storms=None, ifi=None, emdat=frame, last_year=2001,
                     sources={"emdat": {"id": "emdat"}}, trend=lambda years, values: {"direction": "insufficient"})
    assert block["monthly"]["source"]["id"] == "emdat_public" and block["monthly"]["scope"] == "worldwide"
    assert block["daily"]["dropped"] == 2 and "no start day" in block["daily"]["note"]
    assert block["daily"]["n_events"] == 3


def test_without_dates_the_block_says_so() -> None:
    world = pd.DataFrame({"type": ["flood"], "year": [2000], "n_events": [2]})
    block = ec.build("flood", world=world, quakes=None, storms=None, ifi=None, emdat=None, last_year=2001,
                     sources={"emdat": {"id": "emdat"}}, trend=lambda years, values: {"direction": "insufficient"})
    assert block["monthly"]["available"] is False and "no event dates" in block["monthly"]["reason"]
    assert block["daily"]["available"] is False
