"""Level 2 (flood risk model) and Level 3 (resource allocation).

Runs on the committed CSVs in ``backend/data/clean/flood/``; no network.
"""

from __future__ import annotations

import math

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.flood_pipeline import (
    CLEAN_DIR,
    DISTRICTS,
    KERALA_STATE_POPULATION_2011,
    _date_readings,
    prior_rate,
    resolve_ifi_dates,
)
from backend.services.flood_risk import FEATURE_KEYS, load_flood_model, risk_level


@pytest.fixture(scope="module")
def flood():
    return load_flood_model()


# ── pipeline ─────────────────────────────────────────────────────────────────


def test_ambiguous_ifi_dates_are_read_both_ways() -> None:
    from datetime import date

    assert _date_readings("08-01-2018 00:00") == [date(2018, 1, 8), date(2018, 8, 1)]
    assert _date_readings("30-08-2018 00:00") == [date(2018, 8, 30)]


def test_ifi_dates_follow_event_order_and_duration() -> None:
    """IFI stores the August 2018 Kerala event as 08-01-2018 to 30-08-2018 (30 days)."""
    raw = pd.DataFrame({
        "UEI": ["UEI-IMD-FL-2018-0035", "UEI-IMD-FL-2018-0036", "UEI-IMD-FL-2019-0065"],
        "Start Date": ["29-05-2018 00:00", "08-01-2018 00:00", "08-09-2019 00:00"],
        "End Date": ["31-07-2018 00:00", "30-08-2018 00:00", "08-09-2019 00:00"],
        "Duration(Days)": [34.0, 30.0, 1.0],
    })
    fixed = resolve_ifi_dates(raw).set_index("UEI")
    assert fixed.loc["UEI-IMD-FL-2018-0036", "start"] == pd.Timestamp("2018-08-01")
    assert fixed.loc["UEI-IMD-FL-2018-0036", "end"] == pd.Timestamp("2018-08-30")
    assert fixed.loc["UEI-IMD-FL-2018-0035", "start"] == pd.Timestamp("2018-05-29")
    # Nothing earlier in 2019 here, so the earliest reading wins: 9 August (Kavalappara, Puthumala).
    assert fixed.loc["UEI-IMD-FL-2019-0065", "start"] == pd.Timestamp("2019-08-09")


def test_every_district_has_census_population() -> None:
    districts = pd.read_csv(CLEAN_DIR / "districts.csv")
    assert sorted(districts["district"]) == sorted(DISTRICTS)
    assert districts["population"].sum() == KERALA_STATE_POPULATION_2011


def test_training_table_covers_every_district_month() -> None:
    months = pd.read_csv(CLEAN_DIR / "months.csv")
    assert len(months) == 14 * (2023 - 1981 + 1) * 4
    assert months[FEATURE_KEYS].notna().all().all()
    # August 2018 and August 2019: IFI records floods in all 14 districts.
    for year in (2018, 2019):
        assert months[(months["year"] == year) & (months["month"] == 8)]["flood"].sum() == 14
    assert months[(months["year"] == 2018) & (months["month"] == 9)]["flood"].sum() == 0


def test_flood_history_never_sees_its_own_season() -> None:
    labels = pd.DataFrame({
        "district": ["A"] * 4, "year": [2000, 2001, 2002, 2003], "month": [6] * 4, "flood": [1, 0, 0, 1],
    })
    assert prior_rate(labels, "A", 2003, window=3) == pytest.approx(1 / 3)  # 2000-2002 only
    assert math.isnan(prior_rate(labels, "A", 2000, window=3))


# ── model ────────────────────────────────────────────────────────────────────


def test_holdout_metrics_beat_the_baselines(flood) -> None:
    ev = flood.evaluation
    assert ev["split"] == {"train": [1981, 2012], "test": [2013, 2023]}
    assert ev["logistic"]["roc_auc"] > 0.75
    assert ev["logistic"]["roc_auc"] > ev["climatology"]["roc_auc"]
    assert ev["logistic"]["roc_auc"] > ev["history_only"]["roc_auc"]
    assert ev["logistic"]["accuracy"] > ev["always_no_flood"]["accuracy"]


def test_known_events_back_test(flood) -> None:
    """Out-of-sample: the 1981-2012 model scoring months it never saw."""
    events = {(e["year"], e["month"]): e for e in flood.evaluation["backtest"]}
    aug_2019 = events[(2019, 8)]
    assert aug_2019["flagged_high"] >= 10
    aug_2018 = events[(2018, 8)]
    assert all(d["level"] != "low" for d in aug_2018["districts"])
    quiet = events[(2018, 9)]
    assert quiet["flagged_high"] == 0 and quiet["mean_probability"] < 0.25


def test_contributions_add_up_to_the_probability(flood) -> None:
    result = flood.score("Alappuzha")
    logit = result["baseline_log_odds"] + sum(f["contribution"] for f in result["factors"])
    assert logit == pytest.approx(result["log_odds"], abs=0.01)
    assert 1 / (1 + math.exp(-result["log_odds"])) == pytest.approx(result["probability"], abs=0.001)


def test_heavy_rain_raises_the_risk(flood) -> None:
    base = flood.score("Ernakulam")["probability"]
    storm = flood.score("Ernakulam", {"max_3day_rain_mm": 450, "rain_pct_normal": 250})["probability"]
    assert storm > base
    assert risk_level(storm) in ("high", "critical")


def test_score_validates_input(flood) -> None:
    with pytest.raises(ValueError, match="Unknown district"):
        flood.score("Atlantis")
    with pytest.raises(ValueError, match="Missing"):
        flood.score(None, {"rain_pct_normal": 120})
    with pytest.raises(ValueError, match="between"):
        flood.score("Kollam", {"soil_wetness_before": 3})


def test_kerala_dataset_label_is_a_rainfall_cutoff(flood) -> None:
    """The reason the Kerala dataset is a check, not the training label."""
    check = flood.kerala_check()
    assert check["label_cutoff"]["max_no_year_mm"] - check["label_cutoff"]["min_yes_year_mm"] < 10
    assert check["power_vs_imd_r"] > 0.5


# ── endpoints ────────────────────────────────────────────────────────────────


def test_flood_risk_endpoints(client: TestClient) -> None:
    body = client.get("/api/flood-risk").json()
    assert len(body["current"]["districts"]) == 14
    assert {s["id"] for s in body["scenarios"]} >= {"current", "2018-08", "2019-08"}
    assert client.get("/api/flood-risk/scenario/2018-08").json()["kind"] == "backtest"
    assert client.get("/api/flood-risk/scenario/1900-01").status_code == 400
    scored = client.get("/api/flood-risk/score", params={"district": "Idukki", "max_3day_rain_mm": 300})
    assert scored.status_code == 200 and scored.json()["overridden"] == ["max_3day_rain_mm"]
