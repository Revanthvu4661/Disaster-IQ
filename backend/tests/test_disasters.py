"""Historical impact: taxonomy, pipeline steps, analytics and endpoints."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend import data_pipeline as dp
from backend import disaster_types
from backend.services import history as hs

FRONTEND_TYPES = Path(__file__).resolve().parents[2] / "frontend" / "src" / "config" / "disasterTypes.js"


# ── taxonomy ─────────────────────────────────────────────────────────────────
def test_backend_and_frontend_list_the_same_types_in_order() -> None:
    js_ids = re.findall(r"^\s{4}id: '([a-z]+)'", FRONTEND_TYPES.read_text(encoding="utf-8"), re.M)
    assert js_ids == disaster_types.IDS == ["earthquake", "flood", "cyclone"]


def test_only_earthquake_and_cyclone_have_point_sources() -> None:
    assert {d.id: d.point_source for d in disaster_types.DISASTER_TYPES} == {
        "earthquake": "usgs", "flood": None, "cyclone": "ibtracs",
    }
    assert disaster_types.get("cyclone").caveat


# ── pipeline units ───────────────────────────────────────────────────────────
def test_running_year_is_excluded() -> None:
    today = datetime(2026, 9, 24, tzinfo=timezone.utc)
    assert dp.last_complete_year(2026, today) == 2025
    assert dp.last_complete_year(2024, today) == 2024


def test_severity_index_is_log_min_max_weighted() -> None:
    frame = pd.DataFrame({
        "deaths": [0, 9, 99],
        "total_affected": [0, 9, 99],
        "damages_usd": [0, 9, 99],
    })
    score = dp.severity_index(frame)
    assert score.tolist() == [0.0, 50.0, 100.0]


def test_missing_metric_counts_as_zero_in_severity() -> None:
    frame = pd.DataFrame({"deaths": [0, 99], "total_affected": [99, 99], "damages_usd": [0, 0]})
    score = dp.severity_index(frame)
    # affected is constant (no spread), damages all zero: only deaths separates them.
    assert score.tolist() == [0.0, 50.0]


def test_derived_ratios_need_both_inputs() -> None:
    frame = pd.DataFrame({
        "deaths": [10, 0, 5], "total_affected": [1000, 100, 0], "damages_usd": [2000.0, 0.0, 10.0],
    })
    out = dp.add_derived(frame)
    assert out.fatality_rate_pct.iloc[0] == pytest.approx(1.0)
    assert np.isnan(out.fatality_rate_pct.iloc[1]) and np.isnan(out.fatality_rate_pct.iloc[2])
    assert out.loss_per_affected_usd.iloc[0] == pytest.approx(2.0)
    assert np.isnan(out.loss_per_affected_usd.iloc[2])


@pytest.mark.parametrize("wind,category", [(40, 0), (64, 1), (90, 2), (100, 3), (120, 4), (150, 5)])
def test_saffir_simpson(wind: int, category: int) -> None:
    assert dp.saffir_simpson(wind) == category


def test_clean_owid_drops_aggregates_and_empty_rows(tmp_path: Path) -> None:
    columns = {}
    for d in disaster_types.DISASTER_TYPES:
        for stem in dp.IMPACT_METRICS.values():
            columns[f"{stem}_{d.owid_key}"] = [0, 0, 0]
    wide = pd.DataFrame({"country": ["Haiti", "World", "Chile"], "year": [2010, 2010, 2010], **columns})
    wide.loc[0, "deaths_earthquake"] = 100
    wide.loc[1, "deaths_earthquake"] = 100
    path = tmp_path / "yearly.csv"
    wide.to_csv(path, index=False)
    codes = pd.DataFrame({"country": ["Haiti", "World", "Chile"], "iso3": ["HTI", "OWID_WRL", "CHL"],
                          "kind": ["country", "aggregate", "country"]})
    records, world = dp.clean_owid(path, codes, 2025)
    assert records[["type", "country", "deaths"]].to_dict("records") == [
        {"type": "earthquake", "country": "Haiti", "deaths": 100}
    ]
    assert int(world[world.type == "earthquake"].deaths.iloc[0]) == 100


# ── analytics units ──────────────────────────────────────────────────────────
def test_trend_verdict_needs_significance() -> None:
    years = pd.Series(range(1980, 2020))
    rising = hs.trend_verdict(years, years * 2.0)
    assert rising["direction"] == "increasing" and rising["spearman_rho"] == 1.0
    noise = hs.trend_verdict(years, pd.Series(np.random.default_rng(1).normal(size=40)))
    assert noise["direction"] == "no clear trend"
    assert hs.trend_verdict(years[:3], years[:3])["direction"] == "insufficient"


def test_correlation_uses_only_records_reporting_both() -> None:
    frame = pd.DataFrame({
        "country": list("abcde"), "year": [2000] * 5,
        "deaths": [1, 10, 100, 1000, 0], "total_affected": [10, 100, 1000, 10000, 50],
    })
    result = hs.correlation(frame, "total_affected", "deaths")
    assert result["n"] == 4
    assert result["pearson_log"] == pytest.approx(1.0)


def test_seasonality_detects_a_peak() -> None:
    months = pd.Series([9] * 60 + list(range(1, 13)) * 3)
    result = hs.seasonality(months)
    assert result["seasonal"] is True
    assert result["peak_month"]["label"] == "Sep"
    flat = hs.seasonality(pd.Series(list(range(1, 13)) * 20))
    assert flat["seasonal"] is False


# ── the real data ────────────────────────────────────────────────────────────
def test_known_disasters_match_the_public_record(tables: dict) -> None:
    records = tables["impact_records"]

    def row(dtype: str, country: str, year: int) -> pd.Series:
        return records[(records.type == dtype) & (records.country == country) & (records.year == year)].iloc[0]

    assert row("earthquake", "Haiti", 2010).deaths == 222_570
    assert row("cyclone", "Myanmar", 2008).deaths > 130_000  # Cyclone Nargis
    assert row("earthquake", "Japan", 2011).damages_usd > 2e11


def test_money_uses_the_cpi_adjusted_series(tables: dict) -> None:
    """OWID's constant-USD series explodes for high-inflation countries; it must not leak in."""
    assert tables["impact_records"].damages_usd.max() < 1e12


def test_record_sums_match_owid_world_totals(tables: dict) -> None:
    records, world = tables["impact_records"], tables["world_yearly"]
    for type_id in disaster_types.IDS:
        assert records[records.type == type_id].deaths.sum() == world[world.type == type_id].deaths.sum()


def test_point_sources_are_within_their_filters(tables: dict) -> None:
    assert tables["earthquakes"].magnitude.min() >= dp.USGS_MIN_MAGNITUDE
    storms = tables["cyclones"]
    assert storms.max_wind_kt.min() >= dp.TROPICAL_STORM_KT
    assert storms.season.min() >= dp.IBTRACS_FIRST_SEASON


def test_every_page_payload_has_the_eight_blocks(history) -> None:
    for type_id, payload in history.types.items():
        assert {"human", "economic", "frequency", "geography", "severity", "time", "correlation", "recovery"} <= set(payload)
        recovery = payload["recovery"]
        assert recovery["reconstruction"]["records"] <= recovery["reconstruction"]["of_records"]
        assert {u["metric"] for u in recovery["unavailable"]} >= {"Recovery time", "Rebuilding progress"}
        decades = recovery["resilience"]["decades"]
        assert decades and all(d["decade"] >= 1980 for d in decades)
        assert all(d["deaths_per_1000"] is None or d["deaths_per_1000"] >= 0 for d in decades)
        assert payload["frequency"]["months"]["available"] is (type_id in ("earthquake", "cyclone"))
        assert all(metric["value"] > 0 for metric in payload["human"]["metrics"])
        scores = [row["score"] for row in payload["severity"]["top"]]
        assert scores == sorted(scores, reverse=True) and 0 < scores[-1] <= scores[0] <= 100


def test_overview_comparison_is_computed_per_type(history) -> None:
    rows = {row["id"]: row for row in history.overview["comparison"]}
    assert list(rows) == disaster_types.IDS
    for row in rows.values():
        assert row["avg_deaths_per_event"] == pytest.approx(row["deaths"] / row["events"])
    assert len(history.overview["top_severity"]["top"]) == hs.SEVERITY_TOP_N


# ── endpoints ────────────────────────────────────────────────────────────────
def test_disaster_endpoints(client: TestClient) -> None:
    assert [t["id"] for t in client.get("/api/disasters/types").json()] == disaster_types.IDS
    assert client.get("/api/disasters/overview").status_code == 200
    body = client.get("/api/disasters/earthquake").json()
    assert body["geography"]["precision"] == "point"
    assert client.get("/api/disasters/flood").json()["geography"]["precision"] == "country"
    assert client.get("/api/disasters/tsunami").status_code == 404


def test_history_map(client: TestClient) -> None:
    body = client.get("/api/history/map", params={"decade": 2010}).json()
    assert set(body["layers"]) == set(disaster_types.IDS)
    assert body["layers"]["earthquake"]["precision"] == "point"
    assert body["layers"]["flood"]["precision"] == "country"
    old = client.get("/api/history/map", params={"decade": 1960, "types": "cyclone"}).json()
    assert old["layers"]["cyclone"]["available"] is False
    assert client.get("/api/history/map", params={"decade": 1850}).status_code == 404
    assert client.get("/api/history/map", params={"decade": 2010, "types": "x"}).status_code == 404
