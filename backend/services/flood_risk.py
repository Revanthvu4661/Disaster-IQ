"""Level 2: flood-risk model for every district of India.

A logistic regression predicts, for one district and one calendar month, the
probability that the India Flood Inventory (IFI) records a flood event touching
that district. All twelve months are used, so northeast-monsoon floods
(Tamil Nadu, coastal Andhra Pradesh, October-December) count as well as the
southwest monsoon.

Why IFI and not the Kerala dataset's FLOODS flag as the label: the Kerala
dataset has one row per year for the whole state, and its flag is almost
exactly a cut-off on annual rainfall (every NO year <= 2,931 mm, every YES
year >= 2,923 mm), so a model trained on it only relearns that cut-off. It is
used here as an independent check instead (see ``kerala_check``).

Features (built by ``backend/flood_pipeline.py``):

    rain_pct_normal       rainfall in the window as % of the district's
                          1991-2020 normal for the same month (NASA POWER),
                          capped at 1,000%
    max_3day_rain_mm      heaviest 3-day rainfall in the window (NASA POWER)
    soil_wetness_before   root-zone soil wetness (0-1) in the 7 days before the
                          window (NASA POWER GWETROOT)
    elevation_m           mean elevation of the district (DEM samples)
    prior_flood_rate      share of the previous 10 years with a recorded IFI
                          flood in the district
    region                the district's state, one-hot: each state gets its
                          own baseline, since IFI's reporting practice and
                          climate differ widely across India

Evaluation is a time split: fit on 1981-2012, score 2013-2023, and report the
overall and per-state ROC-AUC, precision and recall. The served model is then
refit on every row. Everything is computed at startup from the committed CSVs.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.preprocessing import StandardScaler

from backend.config import DATA_DIR

FLOOD_DIR = DATA_DIR / "clean" / "flood"

FEATURES: list[dict[str, Any]] = [
    {"key": "rain_pct_normal", "label": "Rainfall vs normal", "unit": "% of normal",
     "min": 0, "max": 1000, "step": 5, "source": "nasa_power"},
    {"key": "max_3day_rain_mm", "label": "Heaviest 3-day rainfall", "unit": "mm",
     "min": 0, "max": 1500, "step": 5, "source": "nasa_power"},
    {"key": "soil_wetness_before", "label": "Soil wetness before", "unit": "0-1",
     "min": 0, "max": 1, "step": 0.01, "source": "nasa_power"},
    {"key": "elevation_m", "label": "Mean elevation", "unit": "m",
     "min": 0, "max": 5000, "step": 10, "source": "elevation"},
    {"key": "prior_flood_rate", "label": "Flood history", "unit": "share",
     "min": 0, "max": 1, "step": 0.1, "source": "ifi"},
]
FEATURE_KEYS = [f["key"] for f in FEATURES]
REGION = "state"            # the region feature: one dummy per state
REGION_LABEL = "Region"
LABEL = "flood"
TRAIN_UNTIL = 2012          # time split: fit <= 2012, test 2013-2023
THRESHOLD = 0.5             # probability at which a window counts as "predicted flood"
ACTION_THRESHOLD = 0.25     # "medium or above": the operating point a planner acts on
RANDOM_STATE = 42
MIN_REGION_POSITIVES = 20   # a state needs this many test-period floods to get its own AUC row

#: Risk levels by predicted probability (lower bound inclusive).
RISK_LEVELS = [
    {"level": "critical", "min": 0.75, "label": "Critical"},
    {"level": "high", "min": 0.50, "label": "High"},
    {"level": "medium", "min": 0.25, "label": "Medium"},
    {"level": "low", "min": 0.0, "label": "Low"},
]

MONTH_NAMES = {1: "January", 2: "February", 3: "March", 4: "April", 5: "May", 6: "June", 7: "July",
               8: "August", 9: "September", 10: "October", 11: "November", 12: "December"}

#: Known months used as sanity checks, all inside the 2013-2023 test years, so they are scored by the
#: model fitted on 1981-2012 only. Each is judged inside ``states``; IFI confirms what was recorded there.
KNOWN_EVENTS: list[dict[str, Any]] = [
    {"year": 2018, "month": 8, "states": ["Kerala"], "name": "Kerala floods, August 2018", "expect": "flood",
     "note": "Worst flooding in Kerala in almost a century. IFI records 339 deaths in its August event."},
    {"year": 2019, "month": 8, "states": ["Kerala"], "name": "Kerala floods, August 2019", "expect": "flood",
     "note": "IFI records floods in all 14 districts, with deaths reported in several."},
    {"year": 2013, "month": 6, "states": ["Kerala"], "name": "Kerala early monsoon floods, June 2013",
     "expect": "flood", "note": "A very wet monsoon onset. IFI records floods in 11 of 14 districts."},
    {"year": 2018, "month": 9, "states": ["Kerala"], "name": "Kerala, September 2018 (quiet month)",
     "expect": "quiet", "note": "A negative control: rain fell to about half of normal and IFI records no flood "
                               "anywhere in Kerala."},
    {"year": 2013, "month": 6, "states": ["Uttarakhand"], "name": "Uttarakhand floods, June 2013",
     "expect": "flood", "note": "The Kedarnath disaster (16-17 June), one of the deadliest Himalayan floods. IFI lists "
                             "floods in only some of the state's districts, so high ratings elsewhere count as "
                             "false alarms against it."},
    {"year": 2015, "month": 12, "states": ["Tamil Nadu", "Puducherry"],
     "name": "Chennai and Tamil Nadu floods, December 2015", "expect": "flood",
     "note": "Northeast-monsoon floods: IFI lists events from 9 November to 11 December 2015 across Tamil "
             "Nadu, a season the earlier June-September model never scored."},
    {"year": 2022, "month": 6, "states": ["Assam"], "name": "Assam floods, June 2022", "expect": "flood",
     "note": "Brahmaputra and Barak valley floods; IFI lists floods across almost the whole state."},
]

#: A second negative control, picked from IFI before looking at the model: a month in the test years with no
#: flood recorded in any district of a state, in one of that state's three most flood-prone calendar months
#: (by its 1981-2012 flood rate), with rain well below normal. Several months qualify; this is one of them.
CONTROL_EVENT: dict[str, Any] | None = {
    "year": 2014, "month": 8, "states": ["Punjab"], "name": "Punjab, August 2014 (quiet month)",
    "expect": "quiet",
    "note": "A negative control chosen from IFI: August is one of Punjab's most flood-prone months, yet IFI records "
            "no flood in any district, and NASA POWER shows about 30% of normal rain."}


def all_events() -> list[dict[str, Any]]:
    return list(KNOWN_EVENTS) + ([CONTROL_EVENT] if CONTROL_EVENT else [])


def risk_level(probability: float) -> str:
    for band in RISK_LEVELS:
        if probability >= band["min"]:
            return band["level"]
    return "low"


def _metrics(y_true: np.ndarray, prob: np.ndarray, threshold: float = THRESHOLD) -> dict[str, Any]:
    pred = (prob >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    both = len(set(y_true)) > 1
    return {
        "threshold": threshold,
        "n": int(len(y_true)),
        "positives": int(y_true.sum()),
        "accuracy": round(float(accuracy_score(y_true, pred)), 3),
        "precision": round(float(precision_score(y_true, pred, zero_division=0)), 3),
        "recall": round(float(recall_score(y_true, pred, zero_division=0)), 3),
        "f1": round(float(f1_score(y_true, pred, zero_division=0)), 3),
        "roc_auc": round(float(roc_auc_score(y_true, prob)), 3) if both else None,
        "average_precision": round(float(average_precision_score(y_true, prob)), 3) if both else None,
        "brier": round(float(brier_score_loss(y_true, prob)), 3),
        "confusion": {"tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn)},
    }


@dataclass
class Fit:
    """A fitted logistic regression: standardised features plus one dummy per state."""

    scaler: StandardScaler
    model: LogisticRegression
    regions: list[str]

    @classmethod
    def train(cls, frame: pd.DataFrame) -> "Fit":
        regions = sorted(frame[REGION].unique())
        scaler = StandardScaler().fit(frame[FEATURE_KEYS])
        fit = cls(scaler, LogisticRegression(max_iter=3000, random_state=RANDOM_STATE), regions)
        fit.model.fit(fit.design(frame[FEATURE_KEYS].to_numpy(float), frame[REGION].to_numpy()),
                      frame[LABEL])
        return fit

    def design(self, values: np.ndarray, states: np.ndarray) -> np.ndarray:
        """Standardised features, then one 0/1 column per state (all zero for an unknown state)."""
        dummies = (np.asarray(states)[:, None] == np.array(self.regions)[None, :]).astype(float)
        return np.hstack([self.scaler.transform(pd.DataFrame(values, columns=FEATURE_KEYS)), dummies])

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        return self.model.predict_proba(self.design(frame[FEATURE_KEYS].to_numpy(float),
                                                    frame[REGION].to_numpy()))[:, 1]

    @property
    def intercept(self) -> float:
        return float(self.model.intercept_[0])

    def region_effect(self, state: str | None) -> float:
        if state in self.regions:
            return float(self.model.coef_[0][len(FEATURE_KEYS) + self.regions.index(state)])
        return 0.0


def _fmt(value: float, unit: str) -> str:
    if unit == "% of normal":
        return f"{value:.0f}% of normal"
    if unit == "share":
        return f"{value * 100:.0f}% of past years"
    if unit == "0-1":
        return f"{value:.2f}"
    return f"{value:,.0f} {unit}"


def _summary(factors: list[dict]) -> str:
    """'Heaviest 3-day rainfall 410 mm raises risk; rainfall vs normal 190% of normal raises risk.'"""
    top = [f for f in factors if abs(f["contribution"]) >= 0.1][:3] or factors[:1]
    parts = []
    for f in top:
        if f["key"] == REGION:
            parts.append(f"{f['value']}'s baseline {f['direction']} risk")
        else:
            parts.append(f"{f['label'].lower()} {_fmt(f['value'], f['unit'])} {f['direction']} risk")
    text = "; ".join(parts)
    return text[:1].upper() + text[1:] + "."


def _nan_to_none(value: Any) -> Any:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return value


@dataclass
class FloodModel:
    """The served model plus everything the Flood Risk Prediction page shows."""

    districts: pd.DataFrame
    months: pd.DataFrame
    current: pd.DataFrame
    kerala: pd.DataFrame
    meta: dict
    report: pd.DataFrame | None = None
    fit: Fit = field(init=False)
    split_fit: Fit = field(init=False)
    evaluation: dict = field(init=False)
    payload: dict = field(init=False)

    def __post_init__(self) -> None:
        data = self.months.dropna(subset=FEATURE_KEYS + [LABEL])
        self._districts = self.districts.set_index("district")
        self.evaluation = self._evaluate(data)
        self.fit = Fit.train(data)
        self.payload = self._build_payload(data)

    # ── scoring ──────────────────────────────────────────────────────────

    def explain(self, features: dict[str, float], state: str | None = None, fit: Fit | None = None) -> dict[str, Any]:
        """Probability, level and each factor's contribution in log-odds.

        A contribution is coefficient x standardised value: how far that
        feature moves the log-odds away from an average district-month. The
        region's contribution is its state's own baseline. Positive raises the risk.
        """
        fit = fit or self.fit
        x = np.array([[float(features[k]) for k in FEATURE_KEYS]])
        z = ((x - fit.scaler.mean_) / fit.scaler.scale_)[0]
        coef = fit.model.coef_[0]
        region = fit.region_effect(state)
        logit = fit.intercept + float(coef[:len(FEATURE_KEYS)] @ z) + region
        probability = 1 / (1 + math.exp(-logit))
        factors = []
        for index, spec in enumerate(FEATURES):
            contribution = float(coef[index] * z[index])
            factors.append({
                "key": spec["key"],
                "label": spec["label"],
                "unit": spec["unit"],
                "value": round(float(x[0, index]), 3),
                "average": round(float(fit.scaler.mean_[index]), 3),
                "contribution": round(contribution, 3),
                "direction": "raises" if contribution > 0 else "lowers",
            })
        if state in fit.regions:
            factors.append({"key": REGION, "label": REGION_LABEL, "unit": "state", "value": state,
                            "average": None, "contribution": round(region, 3),
                            "direction": "raises" if region > 0 else "lowers"})
        factors.sort(key=lambda f: abs(f["contribution"]), reverse=True)
        return {
            "probability": round(probability, 3),
            "level": risk_level(probability),
            "log_odds": round(logit, 3),
            "baseline_log_odds": round(fit.intercept, 3),
            "factors": factors,
            "summary": _summary(factors),
        }

    def score(self, district: str | None = None, overrides: dict[str, float] | None = None,
              state: str | None = None) -> dict:
        """Score a district's current window, optionally with some features overridden.

        Without a district every feature must be given, and ``state`` (optional) picks the regional baseline.
        """
        overrides = {k: v for k, v in (overrides or {}).items() if v is not None}
        if district is not None:
            row = self.current[self.current["district"] == district]
            if row.empty:
                raise ValueError(f"Unknown district '{district}'. Use a name from the current predictions "
                                 f"({len(self.districts)} districts, e.g. {', '.join(self.districts['district'][:3])}).")
            inputs = {k: float(row.iloc[0][k]) for k in FEATURE_KEYS}
            state = str(row.iloc[0][REGION])
            if any(math.isnan(v) for k, v in inputs.items() if k not in overrides):
                raise ValueError(f"'{district}' has no complete current data; give the missing features.")
        else:
            missing = [k for k in FEATURE_KEYS if k not in overrides]
            if missing:
                raise ValueError("Without a district, give every feature. Missing: " + ", ".join(missing))
            inputs = {}
            if state is not None and state not in self.fit.regions:
                raise ValueError(f"Unknown state '{state}'. Use one of: {', '.join(self.fit.regions)}")
        for spec in FEATURES:
            if spec["key"] in overrides:
                value = float(overrides[spec["key"]])
                if not spec["min"] <= value <= spec["max"]:
                    raise ValueError(
                        f"{spec['label']} must be between {spec['min']} and {spec['max']} ({spec['unit']})"
                    )
                inputs[spec["key"]] = value
        result = self.explain(inputs, state)
        result["district"] = district
        result["state"] = state
        result["inputs"] = inputs
        result["overridden"] = sorted(overrides)
        return result

    # ── evaluation ───────────────────────────────────────────────────────

    def _evaluate(self, data: pd.DataFrame) -> dict[str, Any]:
        train = data[data["year"] <= TRAIN_UNTIL]
        test = data[data["year"] > TRAIN_UNTIL]
        y_test = test[LABEL].to_numpy()
        self.split_fit = Fit.train(train)
        prob = self.split_fit.predict(test)

        # Random forest on the same features and the same state dummies.
        regions = np.array(self.split_fit.regions)

        def forest_matrix(frame: pd.DataFrame) -> np.ndarray:
            return np.hstack([frame[FEATURE_KEYS].to_numpy(float),
                              (frame[REGION].to_numpy()[:, None] == regions[None, :]).astype(float)])

        forest = RandomForestClassifier(n_estimators=150, min_samples_leaf=25, max_samples=0.5, n_jobs=-1,
                                        random_state=RANDOM_STATE)
        forest.fit(forest_matrix(train), train[LABEL])
        forest_prob = forest.predict_proba(forest_matrix(test))[:, 1]

        # Baselines: flood history alone, and each district-month's training-period flood rate.
        hist_scaler = StandardScaler().fit(train[["prior_flood_rate"]])
        hist = LogisticRegression(max_iter=1000).fit(
            hist_scaler.transform(train[["prior_flood_rate"]]), train[LABEL])
        hist_prob = hist.predict_proba(hist_scaler.transform(test[["prior_flood_rate"]]))[:, 1]
        climatology = train.groupby(["district", "month"])[LABEL].mean().rename("clim").reset_index()
        clim_prob = test[["district", "month"]].merge(climatology, on=["district", "month"], how="left")[
            "clim"].fillna(float(train[LABEL].mean())).to_numpy()

        scored = test.assign(probability=prob, forest=forest_prob)
        return {
            "split": {"train": [int(train["year"].min()), TRAIN_UNTIL],
                      "test": [TRAIN_UNTIL + 1, int(test["year"].max())]},
            "train_rows": int(len(train)),
            "test_rows": int(len(test)),
            "train_positive_rate": round(float(train[LABEL].mean()), 3),
            "test_positive_rate": round(float(test[LABEL].mean()), 3),
            "threshold": THRESHOLD,
            "logistic": _metrics(y_test, prob),
            "logistic_action": _metrics(y_test, prob, ACTION_THRESHOLD),
            "random_forest": _metrics(y_test, forest_prob),
            "random_forest_action": _metrics(y_test, forest_prob, ACTION_THRESHOLD),
            "history_only": _metrics(y_test, hist_prob),
            "climatology": _metrics(y_test, clim_prob),
            "always_no_flood": _metrics(y_test, np.zeros(len(test))),
            "by_region": self._by_region(scored),
            "region_note": (f"States with fewer than {MIN_REGION_POSITIVES} test-period floods are listed without "
                            "an AUC: too few events for it to mean anything."),
            "backtest": self._backtests(scored),
        }

    def _by_region(self, scored: pd.DataFrame) -> list[dict[str, Any]]:
        """Test-period metrics per state for the logistic model (and the forest's AUC beside it)."""
        rows = []
        for state, part in scored.groupby(REGION):
            y = part[LABEL].to_numpy()
            main = _metrics(y, part["probability"].to_numpy())
            action = _metrics(y, part["probability"].to_numpy(), ACTION_THRESHOLD)
            enough = MIN_REGION_POSITIVES <= int(y.sum()) < len(y)
            rows.append({
                "region": state,
                "districts": int(part["district"].nunique()),
                "n": main["n"],
                "positives": main["positives"],
                "positive_rate": round(main["positives"] / main["n"], 3),
                "roc_auc": main["roc_auc"] if enough else None,
                "precision": main["precision"] if main["positives"] else None,
                "recall": main["recall"] if main["positives"] else None,
                "precision_action": action["precision"] if action["positives"] else None,
                "recall_action": action["recall"] if action["positives"] else None,
                "forest_roc_auc": round(float(roc_auc_score(y, part["forest"])), 3) if enough else None,
            })
        rows.sort(key=lambda r: r["positives"], reverse=True)
        return rows

    def _backtests(self, scored: pd.DataFrame) -> list[dict[str, Any]]:
        backtest = []
        for event in all_events():
            window = scored[(scored["year"] == event["year"]) & (scored["month"] == event["month"])
                            & scored[REGION].isin(event["states"])]
            if window.empty:
                continue
            rows = [
                {
                    "district": r.district,
                    "state": r.state,
                    "probability": round(float(r.probability), 3),
                    "level": risk_level(float(r.probability)),
                    "observed": int(r.flood),
                    "rain_pct_normal": float(r.rain_pct_normal),
                    "max_3day_rain_mm": float(r.max_3day_rain_mm),
                }
                for r in window.sort_values("probability", ascending=False).itertuples()
            ]
            high = [r for r in rows if r["level"] in ("high", "critical")]
            medium_up = [r for r in rows if r["level"] != "low"]
            backtest.append({
                **event,
                "id": f"{event['year']}-{event['month']:02d}",
                "region": " and ".join(event["states"]),
                "month_name": MONTH_NAMES[event["month"]],
                "district_count": len(rows),
                "districts": rows,
                "observed_floods": sum(r["observed"] for r in rows),
                "flagged_high": len(high),
                "flagged_medium_up": len(medium_up),
                "flagged_and_observed": sum(r["observed"] for r in high),
                "medium_up_and_observed": sum(r["observed"] for r in medium_up),
                "mean_probability": round(float(window["probability"].mean()), 3),
            })
        return backtest

    def kerala_check(self) -> dict[str, Any]:
        """Two checks against the Kerala dataset (IMD, state level, 1901-2018).

        1. Does NASA POWER's rainfall track IMD's gauge-based Kerala rainfall?
        2. Does the model's statewide mean probability rank the dataset's YES
           years above its NO years (years 1981-2018, which both cover)?
           Uses the June-September district-months, the season the dataset flags.
        """
        full = self.kerala
        both = full.dropna(subset=["power_annual_rainfall_mm"])
        both = both[both["year"] <= 2018]
        r = float(np.corrcoef(both["annual_rainfall"], both["power_annual_rainfall_mm"])[0, 1])
        data = self.months[(self.months[REGION] == "Kerala") & self.months["month"].between(6, 9)]
        data = data.dropna(subset=FEATURE_KEYS)
        statewide = data.assign(p=self.fit.predict(data)).groupby("year")["p"].mean()
        joined = both.set_index("year").join(statewide.rename("mean_probability"), how="inner")
        auc = roc_auc_score(joined["floods"], joined["mean_probability"]) if joined["floods"].nunique() > 1 else None
        return {
            "years": [int(both["year"].min()), int(both["year"].max())],
            "rows_total": int(len(full)),
            "first_year": int(full["year"].min()),
            "last_year": int(full["year"].max()),
            "flood_years_total": int(full["floods"].sum()),
            "power_vs_imd_r": round(r, 3),
            "power_mean_mm": round(float(both["power_annual_rainfall_mm"].mean())),
            "imd_mean_mm": round(float(both["annual_rainfall"].mean())),
            "auc_vs_kerala_flag": round(float(auc), 3) if auc is not None else None,
            "overlap_years": int(len(joined)),
            "label_cutoff": {
                "max_no_year_mm": round(float(full[full["floods"] == 0]["annual_rainfall"].max()), 1),
                "min_yes_year_mm": round(float(full[full["floods"] == 1]["annual_rainfall"].min()), 1),
            },
        }

    # ── payload ──────────────────────────────────────────────────────────

    def scenarios(self) -> list[dict[str, Any]]:
        """The map's scenario switch: the latest 30 days, then each back-test month."""
        cur = self.current
        items = [{"id": "current", "kind": "current", "label": "Latest 30 days",
                  "detail": f"{cur['window_start'].min()} to {cur['as_of'].max()}"}]
        by_month: dict[tuple[int, int], list[dict[str, Any]]] = {}
        for event in all_events():
            by_month.setdefault((event["year"], event["month"]), []).append(event)
        for (year, month), same in by_month.items():
            items.append({"id": f"{year}-{month:02d}", "kind": "backtest",
                          "label": f"{MONTH_NAMES[month]} {year}",
                          "detail": "; ".join(e["name"] for e in same),
                          "states": sorted({s for e in same for s in e["states"]}),
                          "expect": same[0]["expect"] if len({e["expect"] for e in same}) == 1 else "mixed",
                          "note": " ".join(e["note"] for e in same)})
        return items

    def predictions(self, scenario: str = "current") -> dict[str, Any]:
        """District predictions for a scenario id from ``scenarios()``.

        ``current`` scores the latest 30 days with the served model. A back-test
        month (``2018-08``) is scored by the model fitted on 1981-2012 only, so
        the replay is out of sample, and carries what IFI actually recorded.
        """
        if scenario == "current":
            rows = self.current_predictions()
            return {"scenario": "current", "kind": "current", "districts": rows,
                    "window_start": min(r["window_start"] for r in rows),
                    "as_of": max(r["as_of"] for r in rows)}
        known = [item["id"] for item in self.scenarios()]
        if scenario not in known:
            raise ValueError(f"Unknown scenario '{scenario}'. Use one of: {', '.join(known)}")
        year, month = (int(part) for part in scenario.split("-"))
        window = self.months[(self.months["year"] == year) & (self.months["month"] == month)]
        window = window.dropna(subset=FEATURE_KEYS)
        rows = []
        for r in window.itertuples():
            result = self.explain({k: getattr(r, k) for k in FEATURE_KEYS}, r.state, fit=self.split_fit)
            rows.append({
                **self._district_info(r.district),
                "window_start": f"{year}-{month:02d}-01",
                "as_of": (pd.Timestamp(year, month, 1) + pd.offsets.MonthEnd(0)).date().isoformat(),
                "rain_mm": float(r.rain_mm),
                "normal_mm": float(r.normal_mm),
                **{k: float(getattr(r, k)) for k in FEATURE_KEYS},
                **result,
                "observed": int(r.flood),
                "observed_deadly": int(r.deadly),
            })
        rows.sort(key=lambda row: row["probability"], reverse=True)
        return {"scenario": scenario, "kind": "backtest", "districts": rows,
                "window_start": rows[0]["window_start"], "as_of": rows[0]["as_of"]}

    def _district_info(self, name: str) -> dict[str, Any]:
        d = self._districts.loc[name]
        population, households = _nan_to_none(d["population"]), _nan_to_none(d["households"])
        return {
            "district": name,
            "state": str(d["state"]),
            "lat": float(d["lat"]),
            "lon": float(d["lon"]),
            "population": None if population is None else int(population),
            "households": None if households is None else int(households),
            "area_km2": int(d["area_km2"]),
            "low_lying_pct": float(d["low_lying_pct"]),
            "ifi_flood_seasons": int(d["ifi_flood_seasons"]),
            "ifi_deadly_seasons": int(d["ifi_deadly_seasons"]),
            "ifi_seasons": int(d["ifi_seasons"]),
        }

    def current_predictions(self) -> list[dict[str, Any]]:
        rows = []
        complete = self.current.dropna(subset=FEATURE_KEYS)
        for r in complete.itertuples():
            rows.append({
                **self._district_info(r.district),
                "window_start": r.window_start,
                "as_of": r.as_of,
                "rain_mm": float(r.rain_mm),
                "normal_mm": float(r.normal_mm),
                **{k: float(getattr(r, k)) for k in FEATURE_KEYS},
                **self.explain({k: getattr(r, k) for k in FEATURE_KEYS}, r.state),
            })
        rows.sort(key=lambda row: row["probability"], reverse=True)
        return rows

    def _build_payload(self, data: pd.DataFrame) -> dict[str, Any]:
        coef = self.fit.model.coef_[0]
        features = [
            {**spec,
             "coefficient": round(float(c), 3),
             "odds_ratio_per_sd": round(float(math.exp(c)), 3),
             "mean": round(float(m), 3),
             "sd": round(float(s), 3)}
            for spec, c, m, s in zip(FEATURES, coef, self.fit.scaler.mean_, self.fit.scaler.scale_)
        ]
        region_effects = sorted(
            ({"region": s, "coefficient": round(self.fit.region_effect(s), 3),
              "odds_ratio": round(math.exp(self.fit.region_effect(s)), 3),
              "flood_rate": round(float(data[data[REGION] == s][LABEL].mean()), 3),
              "districts": int(data[data[REGION] == s]["district"].nunique())}
             for s in self.fit.regions), key=lambda r: r["coefficient"], reverse=True)
        current = self.current_predictions()
        counts = {band["level"]: 0 for band in RISK_LEVELS}
        for row in current:
            counts[row["level"]] += 1
        no_pop = int(self.districts["population"].isna().sum())
        scored = {row["district"] for row in current}
        unscored = sorted(set(self.districts["district"]) - scored)
        unmatched = self.report[self.report["kind"] == "unmatched"] if self.report is not None else None
        return {
            "region": "India",
            "unit": "district x calendar month (all twelve months)",
            "label": {
                "key": LABEL,
                "definition": "The India Flood Inventory records a flood event that lists the district "
                              "and overlaps the month.",
                "positive_rate": round(float(data[LABEL].mean()), 3),
            },
            "model": {
                "type": "Logistic regression (scikit-learn), standardised features plus one dummy per state",
                "features": features,
                "region_feature": {
                    "key": REGION,
                    "label": REGION_LABEL,
                    "note": "Each state has its own baseline (a 0/1 column) that shifts the log-odds after rain, "
                            "soil, elevation and flood history are counted. It is relative to those inputs, so a dry "
                            "state can have a high baseline: it offsets low rainfall values. Compare the "
                            "“months with a flood” column for raw frequency, not the baseline.",
                    "effects": region_effects,
                },
                "intercept": round(self.fit.intercept, 3),
                "training_rows": int(len(data)),
                "training_years": [int(data["year"].min()), int(data["year"].max())],
                "districts": int(data["district"].nunique()),
                "regions": len(self.fit.regions),
            },
            "risk_levels": RISK_LEVELS,
            "scenarios": self.scenarios(),
            "evaluation": self.evaluation,
            "kerala_check": self.kerala_check(),
            "coverage": {
                "districts": int(len(self.districts)),
                "districts_with_population": int(len(self.districts) - no_pop),
                "districts_without_population": no_pop,
                "districts_scored_now": len(current),
                "districts_unscored": unscored,
                "unmatched_names": None if unmatched is None else int(len(unmatched)),
                "states": sorted(self.districts["state"].unique()),
            },
            "current": {
                "window_start": min(row["window_start"] for row in current) if current else None,
                "as_of": max(row["as_of"] for row in current) if current else None,
                "window_days": int(self.meta["current_window_days"]),
                "counts": counts,
                "districts": current,
            },
            "not_included": [
                {"metric": "River gauge levels",
                 "reason": "River-gauge data not available for this build; risk is estimated from rainfall, "
                           "soil moisture, elevation, region and historical flood frequency."},
                {"metric": "Dam releases and reservoir levels",
                 "reason": "Not in any source used. Dam releases worsened the August 2018 Kerala floods."},
                {"metric": "Rainfall forecast",
                 "reason": "The model scores rain that has already fallen (NASA POWER, about 4 days behind), "
                           "not a weather forecast."},
                {"metric": "Slope, soil type, land use",
                 "reason": "Terrain beyond mean elevation is not a feature."},
                {"metric": "Population for districts created after 2011",
                 "reason": f"{no_pop} districts have no Census 2011 row; their population is unavailable, "
                           "not estimated."},
                *([{"metric": "Districts without soil-wetness data",
                    "reason": f"{', '.join(unscored)}: NASA POWER has no root-zone soil wetness for these cells "
                              "(open water), so they are not scored rather than given an imputed value."}]
                  if unscored else []),
                {"metric": "Sub-district weather",
                 "reason": "NASA POWER's grid cells are about 55 x 62 km, so neighbouring districts can share one "
                           "rainfall series."},
            ],
            "sources": {
                "elevation": self.meta["elevation_source"],
                "power_last_day": self.meta["power_last_day"],
                "built_at": self.meta["built_at"],
                "normal_period": self.meta["normal_period"],
                "ifi_last_year": self.meta["ifi_last_year"],
            },
        }


def load_flood_model(flood_dir: Path = FLOOD_DIR) -> FloodModel:
    report_path = flood_dir / "unmatched_names.csv"
    return FloodModel(
        districts=pd.read_csv(flood_dir / "districts.csv"),
        months=pd.read_csv(flood_dir / "months.csv.gz"),
        current=pd.read_csv(flood_dir / "current.csv"),
        kerala=pd.read_csv(flood_dir / "kerala_imd.csv"),
        meta=json.loads((flood_dir / "meta.json").read_text(encoding="utf-8")),
        report=pd.read_csv(report_path) if report_path.exists() else None,
    )


def main() -> int:
    """Print the evaluation: ``python -m backend.services.flood_risk``."""
    model = load_flood_model()
    ev = model.evaluation
    print(f"train {ev['split']['train']} ({ev['train_rows']} rows, flood rate {ev['train_positive_rate']}), "
          f"test {ev['split']['test']} ({ev['test_rows']} rows, flood rate {ev['test_positive_rate']})")
    for name in ("logistic", "logistic_action", "random_forest", "random_forest_action", "history_only",
                 "climatology", "always_no_flood"):
        m = ev[name]
        print(f"  {name:20s} acc {m['accuracy']:.3f}  prec {m['precision']:.3f}  rec {m['recall']:.3f}  "
              f"f1 {m['f1']:.3f}  auc {m['roc_auc']}  ap {m['average_precision']}  brier {m['brier']}  "
              f"{m['confusion']}")
    for f in model.payload["model"]["features"]:
        print(f"  coef {f['key']:20s} {f['coefficient']:+.3f}  (odds x{f['odds_ratio_per_sd']} per SD)")
    print("  by region (test):")
    for r in ev["by_region"]:
        print(f"    {r['region']:42s} n {r['n']:6d} floods {r['positives']:5d}  auc {r['roc_auc']}  "
              f"prec {r['precision']}  rec {r['recall']}  (0.25: prec {r['precision_action']} rec {r['recall_action']})")
    for event in ev["backtest"]:
        n = event["district_count"]
        print(f"  {event['name']}: high/critical {event['flagged_high']}/{n}, medium+ {event['flagged_medium_up']}/{n}, "
              f"observed {event['observed_floods']}/{n}, both {event['flagged_and_observed']}, "
              f"mean p {event['mean_probability']}")
    print("  kerala check", model.payload["kerala_check"])
    cur = model.payload["current"]
    print(f"  current {cur['window_start']} to {cur['as_of']}: {cur['counts']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
