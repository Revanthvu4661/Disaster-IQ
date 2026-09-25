"""Level 2: flood-risk model for the 14 districts of Kerala.

A logistic regression predicts, for one district and one 30-day window of the
southwest monsoon (June-September), the probability that the India Flood
Inventory (IFI) records a flood event touching that district.

Why IFI and not the Kerala dataset's FLOODS flag as the label: the Kerala
dataset has one row per year for the whole state, and its flag is almost
exactly a cut-off on annual rainfall (every NO year <= 2,931 mm, every YES
year >= 2,923 mm), so a model trained on it only relearns that cut-off. It is
used here as an independent check instead (see ``kerala_check``).

Features (built by ``backend/flood_pipeline.py``):

    rain_pct_normal       rainfall in the window as % of the district's
                          1991-2020 normal for the same dates (NASA POWER)
    max_3day_rain_mm      heaviest 3-day rainfall in the window (NASA POWER)
    soil_wetness_before   root-zone soil wetness (0-1) in the 7 days before the
                          window (NASA POWER GWETROOT)
    elevation_m           mean elevation of the district (DEM samples)
    prior_flood_rate      share of the previous 10 IFI monsoon seasons with a
                          recorded flood in the district

Training rows are district x calendar month, June-September 1981-2023 (2,408
rows). Evaluation is a time split: fit on 1981-2012, score 2013-2023, which
holds the 2018 and 2019 floods. The served model is then refit on every row.
Everything is computed at startup from the committed CSVs (well under a second).
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
     "min": 0, "max": 2500, "step": 10, "source": "elevation"},
    {"key": "prior_flood_rate", "label": "Flood history", "unit": "share",
     "min": 0, "max": 1, "step": 0.1, "source": "ifi"},
]
FEATURE_KEYS = [f["key"] for f in FEATURES]
LABEL = "flood"
TRAIN_UNTIL = 2012          # time split: fit <= 2012, test 2013-2023
THRESHOLD = 0.5             # probability at which a window counts as "predicted flood"
ACTION_THRESHOLD = 0.25     # "medium or above": the operating point a planner acts on
RANDOM_STATE = 42

#: Risk levels by predicted probability (lower bound inclusive).
RISK_LEVELS = [
    {"level": "critical", "min": 0.75, "label": "Critical"},
    {"level": "high", "min": 0.50, "label": "High"},
    {"level": "medium", "min": 0.25, "label": "Medium"},
    {"level": "low", "min": 0.0, "label": "Low"},
]

MONTH_NAMES = {6: "June", 7: "July", 8: "August", 9: "September"}

#: Known months used as sanity checks, all inside the 2013-2023 test years, so
#: they are scored by the model fitted on 1981-2012 only.
KNOWN_EVENTS = [
    {"year": 2018, "month": 8, "name": "Kerala floods, August 2018", "expect": "flood",
     "note": "Worst flooding in Kerala in almost a century. IFI records 339 deaths in its August event."},
    {"year": 2019, "month": 8, "name": "Floods, August 2019", "expect": "flood",
     "note": "IFI records floods in all 14 districts, with deaths reported in several."},
    {"year": 2013, "month": 6, "name": "Early monsoon floods, June 2013", "expect": "flood",
     "note": "A very wet monsoon onset. IFI records floods in 11 of 14 districts."},
    {"year": 2018, "month": 9, "name": "September 2018 (quiet month)", "expect": "quiet",
     "note": "A negative control: rain fell to about half of normal and IFI records no flood anywhere in Kerala."},
]


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


def _fit_logistic(frame: pd.DataFrame) -> tuple[StandardScaler, LogisticRegression]:
    scaler = StandardScaler().fit(frame[FEATURE_KEYS])
    model = LogisticRegression(max_iter=2000, random_state=RANDOM_STATE)
    model.fit(scaler.transform(frame[FEATURE_KEYS]), frame[LABEL])
    return scaler, model


def _fmt(value: float, unit: str) -> str:
    if unit == "% of normal":
        return f"{value:.0f}% of normal"
    if unit == "share":
        return f"{value * 100:.0f}% of past seasons"
    if unit == "0-1":
        return f"{value:.2f}"
    return f"{value:,.0f} {unit}"


def _summary(factors: list[dict]) -> str:
    """'Heaviest 3-day rainfall 410 mm raises risk; rainfall vs normal 190% of normal raises risk.'"""
    top = [f for f in factors if abs(f["contribution"]) >= 0.1][:3] or factors[:1]
    parts = [f"{f['label'].lower()} {_fmt(f['value'], f['unit'])} {f['direction']} risk" for f in top]
    text = "; ".join(parts)
    return text[:1].upper() + text[1:] + "."


@dataclass
class FloodModel:
    """The served model plus everything the Flood Risk Prediction page shows."""

    districts: pd.DataFrame
    months: pd.DataFrame
    current: pd.DataFrame
    kerala: pd.DataFrame
    meta: dict
    scaler: StandardScaler = field(init=False)
    model: LogisticRegression = field(init=False)
    split_scaler: StandardScaler = field(init=False)
    split_model: LogisticRegression = field(init=False)
    evaluation: dict = field(init=False)
    payload: dict = field(init=False)

    def __post_init__(self) -> None:
        data = self.months.dropna(subset=FEATURE_KEYS + [LABEL])
        self.evaluation = self._evaluate(data)
        self.scaler, self.model = _fit_logistic(data)
        self.payload = self._build_payload(data)

    # ── scoring ──────────────────────────────────────────────────────────

    def explain(self, features: dict[str, float], scaler=None, model=None) -> dict[str, Any]:
        """Probability, level and each feature's contribution in log-odds.

        A contribution is coefficient x standardised value: how far that
        feature moves the log-odds away from an average district-month.
        Positive raises the risk.
        """
        scaler = scaler or self.scaler
        model = model or self.model
        x = pd.DataFrame([[float(features[k]) for k in FEATURE_KEYS]], columns=FEATURE_KEYS)
        z = scaler.transform(x)[0]
        coef = model.coef_[0]
        logit = float(model.intercept_[0] + coef @ z)
        probability = 1 / (1 + math.exp(-logit))
        factors = []
        for index, spec in enumerate(FEATURES):
            contribution = float(coef[index] * z[index])
            factors.append({
                "key": spec["key"],
                "label": spec["label"],
                "unit": spec["unit"],
                "value": round(float(x.iloc[0, index]), 3),
                "average": round(float(scaler.mean_[index]), 3),
                "contribution": round(contribution, 3),
                "direction": "raises" if contribution > 0 else "lowers",
            })
        factors.sort(key=lambda f: abs(f["contribution"]), reverse=True)
        return {
            "probability": round(probability, 3),
            "level": risk_level(probability),
            "log_odds": round(logit, 3),
            "baseline_log_odds": round(float(model.intercept_[0]), 3),
            "factors": factors,
            "summary": _summary(factors),
        }

    def score(self, district: str | None = None, overrides: dict[str, float] | None = None) -> dict:
        """Score a district's current window, optionally with some features overridden.

        Without a district every feature must be given.
        """
        overrides = {k: v for k, v in (overrides or {}).items() if v is not None}
        if district is not None:
            row = self.current[self.current["district"] == district]
            if row.empty:
                known = ", ".join(self.districts["district"])
                raise ValueError(f"Unknown district '{district}'. Use one of: {known}")
            inputs = {k: float(row.iloc[0][k]) for k in FEATURE_KEYS}
        else:
            missing = [k for k in FEATURE_KEYS if k not in overrides]
            if missing:
                raise ValueError("Without a district, give every feature. Missing: " + ", ".join(missing))
            inputs = {}
        for spec in FEATURES:
            if spec["key"] in overrides:
                value = float(overrides[spec["key"]])
                if not spec["min"] <= value <= spec["max"]:
                    raise ValueError(
                        f"{spec['label']} must be between {spec['min']} and {spec['max']} ({spec['unit']})"
                    )
                inputs[spec["key"]] = value
        result = self.explain(inputs)
        result["district"] = district
        result["inputs"] = inputs
        result["overridden"] = sorted(overrides)
        return result

    # ── evaluation ───────────────────────────────────────────────────────

    def _evaluate(self, data: pd.DataFrame) -> dict[str, Any]:
        train = data[data["year"] <= TRAIN_UNTIL]
        test = data[data["year"] > TRAIN_UNTIL]
        y_test = test[LABEL].to_numpy()
        scaler, model = _fit_logistic(train)
        self.split_scaler, self.split_model = scaler, model
        prob = model.predict_proba(scaler.transform(test[FEATURE_KEYS]))[:, 1]

        forest = RandomForestClassifier(n_estimators=300, min_samples_leaf=10, random_state=RANDOM_STATE)
        forest.fit(train[FEATURE_KEYS], train[LABEL])
        forest_prob = forest.predict_proba(test[FEATURE_KEYS])[:, 1]

        # Baselines: flood history alone, and each district-month's training-period flood rate.
        hist_scaler = StandardScaler().fit(train[["prior_flood_rate"]])
        hist = LogisticRegression(max_iter=1000).fit(
            hist_scaler.transform(train[["prior_flood_rate"]]), train[LABEL])
        hist_prob = hist.predict_proba(hist_scaler.transform(test[["prior_flood_rate"]]))[:, 1]
        climatology = train.groupby(["district", "month"])[LABEL].mean()
        clim_prob = np.array([climatology.loc[(r.district, r.month)] for r in test.itertuples()])

        scored = test.assign(probability=prob)
        backtest = []
        for event in KNOWN_EVENTS:
            window = scored[(scored["year"] == event["year"]) & (scored["month"] == event["month"])]
            if window.empty:
                continue
            rows = [
                {
                    "district": r.district,
                    "probability": round(float(r.probability), 3),
                    "level": risk_level(float(r.probability)),
                    "observed": int(r.flood),
                    "rain_pct_normal": float(r.rain_pct_normal),
                    "max_3day_rain_mm": float(r.max_3day_rain_mm),
                }
                for r in window.sort_values("probability", ascending=False).itertuples()
            ]
            high = [r for r in rows if r["level"] in ("high", "critical")]
            backtest.append({
                **event,
                "month_name": MONTH_NAMES[event["month"]],
                "districts": rows,
                "observed_floods": sum(r["observed"] for r in rows),
                "flagged_high": len(high),
                "flagged_and_observed": sum(r["observed"] for r in high),
                "mean_probability": round(float(window["probability"].mean()), 3),
            })

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
            "backtest": backtest,
        }

    def kerala_check(self) -> dict[str, Any]:
        """Two checks against the Kerala dataset (IMD, state level, 1901-2018).

        1. Does NASA POWER's rainfall track IMD's gauge-based Kerala rainfall?
        2. Does the model's statewide mean probability rank the dataset's YES
           years above its NO years (years 1981-2018, which both cover)?
        """
        full = self.kerala
        both = full.dropna(subset=["power_annual_rainfall_mm"])
        both = both[both["year"] <= 2018]
        r = float(np.corrcoef(both["annual_rainfall"], both["power_annual_rainfall_mm"])[0, 1])
        data = self.months.dropna(subset=FEATURE_KEYS)
        prob = self.model.predict_proba(self.scaler.transform(data[FEATURE_KEYS]))[:, 1]
        statewide = data.assign(p=prob).groupby("year")["p"].mean()
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
        for event in KNOWN_EVENTS:
            items.append({"id": f"{event['year']}-{event['month']:02d}", "kind": "backtest",
                          "label": f"{MONTH_NAMES[event['month']]} {event['year']}",
                          "detail": event["name"], "expect": event["expect"], "note": event["note"]})
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
        rows = []
        for r in window.itertuples():
            result = self.explain({k: getattr(r, k) for k in FEATURE_KEYS},
                                  scaler=self.split_scaler, model=self.split_model)
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
        d = self.districts.set_index("district").loc[name]
        return {
            "district": name,
            "lat": float(d["lat"]),
            "lon": float(d["lon"]),
            "population": int(d["population"]),
            "households": int(d["households"]),
            "area_km2": int(d["area_km2"]),
            "low_lying_pct": float(d["low_lying_pct"]),
            "ifi_flood_seasons": int(d["ifi_flood_seasons"]),
            "ifi_deadly_seasons": int(d["ifi_deadly_seasons"]),
            "ifi_seasons": int(d["ifi_seasons"]),
        }

    def current_predictions(self) -> list[dict[str, Any]]:
        rows = []
        for r in self.current.itertuples():
            rows.append({
                **self._district_info(r.district),
                "window_start": r.window_start,
                "as_of": r.as_of,
                "rain_mm": float(r.rain_mm),
                "normal_mm": float(r.normal_mm),
                **{k: float(getattr(r, k)) for k in FEATURE_KEYS},
                **self.explain({k: getattr(r, k) for k in FEATURE_KEYS}),
            })
        rows.sort(key=lambda row: row["probability"], reverse=True)
        return rows

    def _build_payload(self, data: pd.DataFrame) -> dict[str, Any]:
        coef = self.model.coef_[0]
        features = [
            {**spec,
             "coefficient": round(float(c), 3),
             "odds_ratio_per_sd": round(float(math.exp(c)), 3),
             "mean": round(float(m), 3),
             "sd": round(float(s), 3)}
            for spec, c, m, s in zip(FEATURES, coef, self.scaler.mean_, self.scaler.scale_)
        ]
        current = self.current_predictions()
        counts = {band["level"]: 0 for band in RISK_LEVELS}
        for row in current:
            counts[row["level"]] += 1
        return {
            "region": "Kerala, India",
            "unit": "district x 30-day window of the southwest monsoon (June-September)",
            "label": {
                "key": LABEL,
                "definition": "The India Flood Inventory records a flood event that lists the district "
                              "and overlaps the window.",
                "positive_rate": round(float(data[LABEL].mean()), 3),
            },
            "model": {
                "type": "Logistic regression (scikit-learn), standardised features",
                "features": features,
                "intercept": round(float(self.model.intercept_[0]), 3),
                "training_rows": int(len(data)),
                "training_years": [int(data["year"].min()), int(data["year"].max())],
                "districts": int(data["district"].nunique()),
            },
            "risk_levels": RISK_LEVELS,
            "scenarios": self.scenarios(),
            "evaluation": self.evaluation,
            "kerala_check": self.kerala_check(),
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
                           "soil moisture, elevation and historical flood frequency."},
                {"metric": "Dam releases and reservoir levels",
                 "reason": "Not in any source used. Dam releases worsened the August 2018 floods."},
                {"metric": "Rainfall forecast",
                 "reason": "The model scores rain that has already fallen (NASA POWER, about 4 days behind), "
                           "not a weather forecast."},
                {"metric": "Slope, soil type, land use",
                 "reason": "Terrain beyond mean elevation is not a feature."},
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
    return FloodModel(
        districts=pd.read_csv(flood_dir / "districts.csv"),
        months=pd.read_csv(flood_dir / "months.csv"),
        current=pd.read_csv(flood_dir / "current.csv"),
        kerala=pd.read_csv(flood_dir / "kerala_imd.csv"),
        meta=json.loads((flood_dir / "meta.json").read_text(encoding="utf-8")),
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
    for event in ev["backtest"]:
        print(f"  {event['name']}: high/critical {event['flagged_high']}/14, observed {event['observed_floods']}/14, "
              f"both {event['flagged_and_observed']}, mean p {event['mean_probability']}")
    print("  kerala check", model.payload["kerala_check"])
    cur = model.payload["current"]
    print(f"  current {cur['window_start']} to {cur['as_of']}: {cur['counts']}")
    for row in cur["districts"]:
        print(f"    {row['district']:18s} p={row['probability']:.2f} {row['level']:8s} {row['summary']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
