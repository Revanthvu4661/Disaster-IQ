"""Level 2 (flood risk model, all of India) and its data pipeline.

Runs on the committed CSVs in ``backend/data/clean/flood/``; no network.
"""

from __future__ import annotations

import math
from datetime import date

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.flood_pipeline import (
    CLEAN_DIR,
    KERALA_STATE_POPULATION_2011,
    _date_readings,
    power_cell,
    prior_rate,
    prior_rates,
    resolve_ifi_dates,
)
from backend.services.flood_risk import FEATURE_KEYS, KNOWN_EVENTS, load_flood_model, risk_level


@pytest.fixture(scope="module")
def flood():
    return load_flood_model()


@pytest.fixture(scope="module")
def districts() -> pd.DataFrame:
    return pd.read_csv(CLEAN_DIR / "districts.csv")


@pytest.fixture(scope="module")
def months() -> pd.DataFrame:
    return pd.read_csv(CLEAN_DIR / "months.csv.gz")


# ── pipeline ─────────────────────────────────────────────────────────────────


def test_ambiguous_ifi_dates_are_read_both_ways() -> None:
    assert _date_readings("08-01-2018 00:00") == [date(2018, 1, 8), date(2018, 8, 1)]
    assert _date_readings("30-08-2018 00:00") == [date(2018, 8, 30)]


def test_ifi_dates_are_day_first_unless_event_order_says_otherwise() -> None:
    """IFI stores August 2018 in Kerala as 08-01-2018 to 30-08-2018 (30 days): 1-30 August."""
    raw = pd.DataFrame({
        "UEI": ["UEI-IMD-FL-2018-0035", "UEI-IMD-FL-2018-0036", "UEI-IMD-FL-2019-0065", "UEI-IMD-FL-2019-0066"],
        "Start Date": ["29-05-2018 00:00", "08-01-2018 00:00", "08-09-2019 00:00", "12-08-2019 00:00"],
        "End Date": ["31-07-2018 00:00", "30-08-2018 00:00", "08-09-2019 00:00", "13-08-2019 00:00"],
        "Duration(Days)": [34.0, 30.0, 1.0, 2.0],
    })
    fixed = resolve_ifi_dates(raw).set_index("UEI")
    assert fixed.loc["UEI-IMD-FL-2018-0036", "start"] == pd.Timestamp("2018-08-01")
    assert fixed.loc["UEI-IMD-FL-2018-0036", "end"] == pd.Timestamp("2018-08-30")
    assert fixed.loc["UEI-IMD-FL-2018-0035", "start"] == pd.Timestamp("2018-05-29")
    # 12 August comes next in the numbering, so 08-09 must be 9 August, not 8 September.
    assert fixed.loc["UEI-IMD-FL-2019-0065", "start"] == pd.Timestamp("2019-08-09")


def test_ifi_day_first_reading_stands_when_the_order_allows_it() -> None:
    """Chennai, December 2015: 01-12-2015 to 03-12-2015 is 1-3 December, not 12 January to 12 March."""
    raw = pd.DataFrame({
        "UEI": ["UEI-IMD-FL-2015-0091", "UEI-IMD-FL-2015-0092", "UEI-IMD-FL-2015-0097"],
        "Start Date": ["17-07-2015 00:00", "09-11-2015 00:00", "01-12-2015 00:00"],
        "End Date": ["17-07-2015 00:00", "09-11-2015 00:00", "03-12-2015 00:00"],
        "Duration(Days)": [1.0, 1.0, 3.0],
        "State": ["Tamil Nadu"] * 3,
    })
    fixed = resolve_ifi_dates(raw).set_index("UEI")
    assert fixed.loc["UEI-IMD-FL-2015-0092", "start"] == pd.Timestamp("2015-11-09")
    assert fixed.loc["UEI-IMD-FL-2015-0097", "start"] == pd.Timestamp("2015-12-01")
    assert fixed.loc["UEI-IMD-FL-2015-0097", "end"] == pd.Timestamp("2015-12-03")


def test_ifi_event_order_only_binds_within_a_state() -> None:
    """Event numbers run in date order inside one state's block, not across states."""
    raw = pd.DataFrame({
        "UEI": ["UEI-IMD-FL-2015-0010", "UEI-IMD-FL-2015-0011"],
        "Start Date": ["21-11-2015 00:00", "03-04-2015 00:00"],
        "End Date": ["21-11-2015 00:00", "03-04-2015 00:00"],
        "Duration(Days)": [1.0, 1.0],
        "State": ["Karnataka", "Kerala"],
    })
    fixed = resolve_ifi_dates(raw).set_index("UEI")
    assert fixed.loc["UEI-IMD-FL-2015-0011", "start"] == pd.Timestamp("2015-04-03")


def test_power_cells_follow_the_merra2_grid() -> None:
    assert power_cell(9.815, 77.002) == (10.0, 76.875)     # Idukki
    assert power_cell(28.6, 77.2) == (28.5, 77.5)           # Delhi
    assert power_cell(9.9, 76.7) == power_cell(10.2, 77.0)  # two nearby districts share one cell


def test_districts_are_all_of_india_with_a_state_each(districts: pd.DataFrame) -> None:
    assert len(districts) > 700 and districts["state"].nunique() >= 35
    assert districts["district"].is_unique
    assert {"Kerala", "Assam", "Tamil Nadu", "Uttarakhand", "Rajasthan"} <= set(districts["state"])
    # A name used in two states carries its state; a unique name stays plain.
    assert "Bilaspur (Chhattisgarh)" in set(districts["district"]) and "Idukki" in set(districts["district"])
    assert districts.groupby("state")["district"].nunique()["Kerala"] == 14


def test_census_population_is_present_or_reported_missing(districts: pd.DataFrame) -> None:
    kerala = districts[districts["state"] == "Kerala"]
    assert kerala["population"].sum() == KERALA_STATE_POPULATION_2011
    report = pd.read_csv(CLEAN_DIR / "unmatched_names.csv")
    reported = set(report[report["kind"] == "no_census_row"]["name"])
    missing = set(districts[districts["population"].isna()]["name"])
    assert missing == reported, "a district lacks a population without being reported"
    assert districts["households"].isna().equals(districts["population"].isna())
    # Never estimated: the matched districts add up to no more than the 2011 census total.
    assert districts["population"].sum() <= 1_210_854_977


def test_unmatched_names_are_under_five_percent_of_districts(districts: pd.DataFrame) -> None:
    report = pd.read_csv(CLEAN_DIR / "unmatched_names.csv")
    unmatched = report[report["kind"] == "unmatched"].drop_duplicates(["source", "state", "name"])
    assert len(unmatched) < 0.05 * len(districts), unmatched[["source", "name"]].to_string()
    assert set(report["kind"]) <= {"unmatched", "no_census_row", "no_polygon", "not_a_district"}


def test_training_table_covers_every_district_and_calendar_month(months: pd.DataFrame, districts: pd.DataFrame) -> None:
    assert len(months) == len(districts) * (2023 - 1981 + 1) * 12
    assert sorted(months["month"].unique()) == list(range(1, 13))
    # Only the first January of the record lacks a week of soil data before it.
    incomplete = months[months[FEATURE_KEYS].isna().any(axis=1)]
    assert set(incomplete["year"]) <= {1981} or incomplete["soil_wetness_before"].isna().all()
    assert months["rain_pct_normal"].max() <= 1000
    # IFI: floods listed for all 14 Kerala districts in August 2018 and 2019, none in September 2018.
    kerala = months[months["state"] == "Kerala"]
    for year in (2018, 2019):
        assert kerala[(kerala["year"] == year) & (kerala["month"] == 8)]["flood"].sum() == 14
    assert kerala[(kerala["year"] == 2018) & (kerala["month"] == 9)]["flood"].sum() == 0


def test_northeast_monsoon_floods_are_in_the_labels(months: pd.DataFrame) -> None:
    """The all-twelve-months change: Tamil Nadu's October-December floods are labelled."""
    tn = months[(months["state"] == "Tamil Nadu") & (months["year"] == 2015)]
    assert tn[tn["month"] == 11]["flood"].sum() >= 15 and tn[tn["month"] == 12]["flood"].sum() >= 15
    ifi_events = pd.read_csv(CLEAN_DIR / "ifi_events.csv")
    december = ifi_events[(ifi_events["state"] == "Tamil Nadu") & (ifi_events["start"] >= "2015-12-01")
                          & (ifi_events["start"] <= "2015-12-11")]
    assert len(december) > 0


def test_flood_history_never_sees_its_own_year() -> None:
    labels = pd.DataFrame({
        "district": ["A"] * 4, "year": [2000, 2001, 2002, 2003], "month": [6] * 4, "flood": [1, 0, 0, 1],
    })
    assert prior_rate(labels, "A", 2003, window=3) == pytest.approx(1 / 3)  # 2000-2002 only
    assert math.isnan(prior_rate(labels, "A", 2000, window=3))


def test_vectorised_flood_history_matches_the_single_district_rule() -> None:
    rng = pd.MultiIndex.from_product([["A", "B"], range(1990, 2001), range(1, 13)], names=["district", "year", "month"])
    labels = rng.to_frame(index=False)
    labels["flood"] = ((labels["year"] * 7 + labels["month"] * 3 + (labels["district"] == "B") * 5) % 11 == 0).astype(int)
    table = prior_rates(labels, range(1991, 2002), window=4).set_index(["district", "year"])["prior_flood_rate"]
    for district in ("A", "B"):
        for year in (1991, 1995, 2000, 2001):
            assert table[(district, year)] == pytest.approx(prior_rate(labels, district, year, window=4))


# ── model ────────────────────────────────────────────────────────────────────


def test_holdout_metrics_beat_the_baselines(flood) -> None:
    ev = flood.evaluation
    assert ev["split"] == {"train": [1981, 2012], "test": [2013, 2023]}
    assert ev["logistic"]["roc_auc"] > 0.7
    assert ev["logistic"]["roc_auc"] > ev["climatology"]["roc_auc"]
    assert ev["logistic"]["roc_auc"] > ev["history_only"]["roc_auc"]
    assert ev["logistic"]["accuracy"] > ev["always_no_flood"]["accuracy"] - 0.01
    assert ev["logistic_action"]["recall"] > ev["logistic"]["recall"]     # the 25% cut-off catches more floods


def test_metrics_are_reported_per_state(flood) -> None:
    by_region = {r["region"]: r for r in flood.evaluation["by_region"]}
    scored_states = set(flood.months.dropna(subset=FEATURE_KEYS)["state"])
    assert set(by_region) == scored_states
    assert by_region["Kerala"]["roc_auc"] > 0.6 and by_region["Assam"]["positives"] > 100
    assert sum(r["n"] for r in by_region.values()) == flood.evaluation["test_rows"]
    # A state with a handful of test floods gets no AUC rather than a meaningless one.
    assert all(r["roc_auc"] is None for r in by_region.values() if r["positives"] < 20)
    assert all(0 <= r["precision"] <= 1 for r in by_region.values() if r["precision"] is not None)


def test_the_region_feature_is_used(flood) -> None:
    effects = {e["region"]: e["coefficient"] for e in flood.payload["model"]["region_feature"]["effects"]}
    assert len(effects) == flood.payload["model"]["regions"] >= 35
    assert max(effects.values()) - min(effects.values()) > 1     # states differ: the feature is not inert
    kerala = flood.score("Idukki")
    assert any(f["key"] == "state" and f["value"] == "Kerala" for f in kerala["factors"])


def test_known_events_back_test(flood) -> None:
    """Out-of-sample: the 1981-2012 model scoring months it never saw, each inside its own state(s)."""
    events = {(e["year"], e["month"], e["states"][0]): e for e in flood.evaluation["backtest"]}
    assert len(events) >= 8
    aug_2019 = events[(2019, 8, "Kerala")]
    assert aug_2019["district_count"] == 14 and aug_2019["flagged_medium_up"] >= 10
    aug_2018 = events[(2018, 8, "Kerala")]
    assert aug_2018["flagged_high"] >= 8 and aug_2018["observed_floods"] == 14
    assert events[(2013, 6, "Uttarakhand")]["district_count"] == 13
    assert events[(2013, 6, "Uttarakhand")]["flagged_medium_up"] >= 1
    assert events[(2022, 6, "Assam")]["observed_floods"] >= 30 and events[(2022, 6, "Assam")]["flagged_high"] >= 15
    tamil_nadu = events[(2015, 12, "Tamil Nadu")]
    assert tamil_nadu["observed_floods"] >= 20      # IFI confirms the December 2015 floods (weather model may not)
    assert {"Tamil Nadu", "Puducherry"} == set(tamil_nadu["states"])
    # Quiet months: IFI records nothing, and the model does not cry wolf.
    for key in ((2018, 9, "Kerala"), (2014, 8, "Punjab")):
        quiet = events[key]
        assert quiet["expect"] == "quiet" and quiet["observed_floods"] == 0
        assert quiet["flagged_high"] == 0 and quiet["mean_probability"] < 0.25


def test_every_expected_flood_is_confirmed_by_ifi(flood) -> None:
    for event in flood.evaluation["backtest"]:
        if event["expect"] == "flood":
            assert event["observed_floods"] > 0, f"IFI records no flood for {event['name']}"
    assert {e["states"][0] for e in KNOWN_EVENTS} >= {"Kerala", "Uttarakhand", "Tamil Nadu", "Assam"}


def test_contributions_add_up_to_the_probability(flood) -> None:
    result = flood.score("Alappuzha")
    logit = result["baseline_log_odds"] + sum(f["contribution"] for f in result["factors"])
    assert logit == pytest.approx(result["log_odds"], abs=0.01)
    assert 1 / (1 + math.exp(-result["log_odds"])) == pytest.approx(result["probability"], abs=0.001)


def test_heavy_rain_raises_the_risk(flood) -> None:
    base = flood.score("Ernakulam")["probability"]
    storm = flood.score("Ernakulam", {"max_3day_rain_mm": 450, "rain_pct_normal": 250})["probability"]
    assert storm > base
    assert risk_level(storm) in ("medium", "high", "critical")


def test_score_validates_input(flood) -> None:
    with pytest.raises(ValueError, match="Unknown district"):
        flood.score("Atlantis")
    with pytest.raises(ValueError, match="Missing"):
        flood.score(None, {"rain_pct_normal": 120})
    with pytest.raises(ValueError, match="between"):
        flood.score("Kollam", {"soil_wetness_before": 3})
    with pytest.raises(ValueError, match="Unknown state"):
        flood.score(None, dict.fromkeys(FEATURE_KEYS, 1), state="Atlantis")


def test_a_hand_entered_score_can_use_a_state_baseline(flood) -> None:
    conditions = {"rain_pct_normal": 150, "max_3day_rain_mm": 200, "soil_wetness_before": 0.6,
                  "elevation_m": 50, "prior_flood_rate": 0.3}
    assam = flood.score(None, conditions, state="Assam")
    rajasthan = flood.score(None, conditions, state="Rajasthan")
    nowhere = flood.score(None, conditions)
    assert assam["probability"] != rajasthan["probability"] != nowhere["probability"]
    assert nowhere["state"] is None and all(f["key"] != "state" for f in nowhere["factors"])


def test_districts_without_a_census_row_are_scored_with_population_unavailable(flood) -> None:
    rows = {r["district"]: r for r in flood.current_predictions()}
    assert len(rows) >= 700
    assert "Lakshadweep" not in rows and flood.payload["coverage"]["districts_unscored"] == ["Lakshadweep"]
    newer = [r for r in rows.values() if r["population"] is None]
    assert newer and all(isinstance(r["probability"], float) for r in newer)
    assert rows["Idukki"]["population"] == 1108974


def test_kerala_dataset_label_is_a_rainfall_cutoff(flood) -> None:
    """The reason the Kerala dataset is a check, not the training label."""
    check = flood.kerala_check()
    assert check["label_cutoff"]["max_no_year_mm"] - check["label_cutoff"]["min_yes_year_mm"] < 10
    assert check["power_vs_imd_r"] > 0.5


# ── endpoints ────────────────────────────────────────────────────────────────


def test_flood_risk_endpoints(client: TestClient) -> None:
    body = client.get("/api/flood-risk").json()
    assert body["region"] == "India"
    assert len(body["current"]["districts"]) == body["coverage"]["districts_scored_now"] >= 700
    assert body["coverage"]["districts_without_population"] > 0
    assert {s["id"] for s in body["scenarios"]} >= {"current", "2018-08", "2019-08", "2013-06", "2015-12", "2022-06"}
    scenario = client.get("/api/flood-risk/scenario/2018-08").json()
    assert scenario["kind"] == "backtest" and len(scenario["districts"]) >= 700
    assert client.get("/api/flood-risk/scenario/1900-01").status_code == 400
    scored = client.get("/api/flood-risk/score", params={"district": "Idukki", "max_3day_rain_mm": 300})
    assert scored.status_code == 200 and scored.json()["overridden"] == ["max_3day_rain_mm"]
    assert scored.json()["state"] == "Kerala"
    by_hand = client.get("/api/flood-risk/score", params={
        "state": "Assam", "rain_pct_normal": 150, "max_3day_rain_mm": 200, "soil_wetness_before": 0.5,
        "elevation_m": 50, "prior_flood_rate": 0.2})
    assert by_hand.status_code == 200 and by_hand.json()["state"] == "Assam"


def test_payload_is_strict_json(client: TestClient) -> None:
    """Districts without a census row must serialise as null, not NaN."""
    text = client.get("/api/flood-risk").text
    assert "NaN" not in text and "Infinity" not in text
