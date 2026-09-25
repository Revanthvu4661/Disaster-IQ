"""Historical disaster-impact analytics, precomputed once at startup.

Every number returned here is a computation over the tables written by
``backend/data_pipeline.py``: OWID/EM-DAT country-year records, OWID/EM-DAT
world event counts, USGS M6+ earthquakes and NOAA IBTrACS tropical cyclones.
When a source lacks a metric the payload says so (``unavailable`` lists)
rather than substituting anything.

Unit of record: OWID publishes EM-DAT summed by country and year, so a
"record" is one country's total for one disaster type in one year.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

from backend import disaster_types
from backend.currency import FxTable, add_inr

#: Trend questions ("is it increasing?") are answered on this window, where
#: EM-DAT recording is reasonably consistent. Earlier decades are shown but not
#: used for the verdict.
TREND_FROM = 1980
TOP_N = 10
SEVERITY_TOP_N = 15
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
#: Significance level for the trend verdicts and the seasonality test.
ALPHA = 0.05

SOURCES = {
    "emdat": {
        "id": "emdat",
        "name": "OWID / EM-DAT",
        "detail": "EM-DAT (CRED / UCLouvain) via Our World in Data, country-year totals",
        "url": "https://ourworldindata.org/natural-disasters",
    },
    "emdat_wdi": {
        "id": "emdat_wdi",
        "name": "OWID / EM-DAT + World Bank",
        "detail": "EM-DAT damages divided by World Bank WDI GDP, computed by Our World in Data",
        "url": "https://ourworldindata.org/natural-disasters",
    },
    "usgs": {
        "id": "usgs",
        "name": "USGS",
        "detail": "USGS ComCat earthquake catalogue, magnitude 6.0 and above",
        "url": "https://earthquake.usgs.gov/earthquakes/search/",
    },
    "ibtracs": {
        "id": "ibtracs",
        "name": "NOAA IBTrACS",
        "detail": "NOAA IBTrACS v04r01 best tracks, storms reaching tropical-storm strength",
        "url": "https://www.ncei.noaa.gov/products/international-best-track-archive",
    },
}

COVERAGE_NOTE = (
    "EM-DAT recorded far fewer disasters before about 1980. Low counts in early "
    "decades partly reflect what was recorded, not only what happened, so "
    "trend verdicts use {from_}–{to} only."
)

HUMAN_METRICS = [
    ("deaths", "Deaths", "Confirmed dead plus missing people, as EM-DAT counts them."),
    ("total_affected", "Total affected", "Injured + needing immediate assistance + left homeless."),
    ("affected", "Needing immediate assistance",
     "EM-DAT's \"affected\": people requiring immediate assistance during the emergency."),
    ("injured", "Injured", "People with injuries or illness needing immediate medical care."),
    ("homeless", "Left homeless", "People needing shelter because their house was destroyed or heavily damaged."),
]

HUMAN_UNAVAILABLE = [
    {"metric": "Missing (as a separate figure)",
     "reason": "EM-DAT folds missing people into deaths, and the free export does not split them out."},
    {"metric": "Displaced",
     "reason": "Not in the export. \"Left homeless\" is the closest figure: people needing shelter, not everyone who fled."},
    {"metric": "Evacuated",
     "reason": "Not recorded in the OWID export of EM-DAT."},
]

ECONOMIC_UNAVAILABLE = [
    {"metric": "Infrastructure, agricultural, housing and business losses",
     "reason": "EM-DAT's free export gives one total-damage figure per record; there is no sector split."},
]

GEOGRAPHY_UNAVAILABLE = [
    {"metric": "Urban vs rural impact",
     "reason": "None of the sources used records whether the affected area was urban or rural."},
]

#: Money shown in the UI: EM-DAT's as-reported US$ converted to ₹ at each
#: record's year. Comparisons across years (Severity Index, trend verdicts,
#: "highest-loss decade") use the inflation-adjusted US$ columns instead.
INR_PAIRS = {
    "damages_nominal_usd": "damages_inr",
    "insured_nominal_usd": "insured_inr",
    "reconstruction_nominal_usd": "reconstruction_inr",
}

EVENT_DEFINITION = (
    "EM-DAT counts a disaster only if it killed 10 or more people, affected 100 or more, led to a declaration of "
    "a state of emergency or triggered a call for international assistance. It is not a count of every "
    "occurrence of the hazard."
)

RECOVERY_UNAVAILABLE = [
    {"metric": "Recovery time", "reason": "How long a place took to recover is not recorded in EM-DAT, USGS or IBTrACS."},
    {"metric": "Rebuilding progress", "reason": "Housing, infrastructure and livelihood recovery are not tracked by any source used."},
    {"metric": "Response time", "reason": "Time to first aid or rescue is not in any source used."},
    {"metric": "Aid delivered", "reason": "EM-DAT records losses, not funding or relief supplies."},
]


# ── helpers ────────────────────────────────────────────────────────────────
def _py(value: Any) -> Any:
    """JSON-safe scalar: numpy → Python, NaN/inf → None."""
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return None if not math.isfinite(float(value)) else float(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def _rows(frame: pd.DataFrame, columns: list[str] | None = None) -> list[dict]:
    frame = frame if columns is None else frame[columns]
    return [{k: _py(v) for k, v in row.items()} for row in frame.to_dict("records")]


def _pct_change(new: float, old: float) -> float | None:
    return None if not old else round((new - old) / old * 100, 1)


def _ratio(numerator: float, denominator: float) -> float | None:
    return None if not denominator else float(numerator) / float(denominator)


def trend_verdict(years: pd.Series, values: pd.Series) -> dict:
    """Spearman rank trend plus a linear slope, over the years given."""
    if len(values) < 5 or values.nunique() < 2:
        return {"direction": "insufficient", "n_years": int(len(values))}
    rho, p_value = stats.spearmanr(years, values)
    slope = np.polyfit(years.astype(float), values.astype(float), 1)[0]
    if p_value < ALPHA:
        direction = "increasing" if rho > 0 else "decreasing"
    else:
        direction = "no clear trend"
    return {
        "direction": direction,
        "spearman_rho": round(float(rho), 3),
        "p_value": round(float(p_value), 4),
        "slope_per_year": float(slope),
        "from": int(years.min()),
        "to": int(years.max()),
        "n_years": int(len(values)),
    }


def correlation(frame: pd.DataFrame, x: str, y: str) -> dict:
    """Pearson r on log10 values and Spearman ρ, over records where both are reported."""
    both = frame[(frame[x] > 0) & (frame[y] > 0)]
    result: dict[str, Any] = {"x": x, "y": y, "n": int(len(both))}
    if len(both) >= 3:
        pearson, pearson_p = stats.pearsonr(np.log10(both[x]), np.log10(both[y]))
        spearman, spearman_p = stats.spearmanr(both[x], both[y])
        result.update({
            "pearson_log": round(float(pearson), 3),
            "pearson_p": float(pearson_p),
            "spearman": round(float(spearman), 3),
            "spearman_p": float(spearman_p),
        })
    result["points"] = [
        [_py(row[x]), _py(row[y]), row["country"], int(row["year"])]
        for row in both[[x, y, "country", "year"]].to_dict("records")
    ]
    return result


def seasonality(months: pd.Series) -> dict:
    """Month counts, the busiest month and 3-month season, and a χ² test against a flat year."""
    counts = months.value_counts().reindex(range(1, 13), fill_value=0).astype(int)
    days = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
    expected = days / days.sum() * counts.sum()
    chi2, p_value = stats.chisquare(counts.values, expected)
    windows = [(m, sum(counts.iloc[(m + k) % 12] for k in range(3))) for m in range(12)]
    start, window_total = max(windows, key=lambda item: item[1])
    peak = int(counts.idxmax())
    return {
        "rows": [{"month": i, "label": MONTHS[i - 1], "count": int(counts.loc[i])} for i in range(1, 13)],
        "peak_month": {"month": peak, "label": MONTHS[peak - 1], "count": int(counts.loc[peak]),
                       "share": _ratio(counts.loc[peak], counts.sum())},
        "peak_season": {
            "label": "–".join([MONTHS[start], MONTHS[(start + 2) % 12]]),
            "count": int(window_total),
            "share": _ratio(window_total, counts.sum()),
        },
        "chi2": round(float(chi2), 2),
        "p_value": float(p_value),
        "seasonal": bool(p_value < ALPHA),
        "total": int(counts.sum()),
    }


# ── the analytics object ───────────────────────────────────────────────────
@dataclass
class History:
    records: pd.DataFrame
    world: pd.DataFrame
    earthquakes: pd.DataFrame
    cyclones: pd.DataFrame
    countries: pd.DataFrame
    meta: dict
    fx: FxTable | None = None
    types: dict[str, dict] = field(default_factory=dict)
    overview: dict = field(default_factory=dict)

    @property
    def last_year(self) -> int:
        return int(self.meta["last_complete_year"])

    @property
    def first_year(self) -> int:
        return int(self.meta["first_year"])

    def coverage(self) -> dict:
        return {
            "first_year": self.first_year,
            "last_year": self.last_year,
            "partial_year_excluded": self.meta.get("partial_year_excluded"),
            "trend_from": TREND_FROM,
            "note": COVERAGE_NOTE.format(from_=TREND_FROM, to=self.last_year),
            "unit": "country-year record",
            "unit_note": (
                "OWID publishes EM-DAT summed by country and year, not event by event. "
                "A record is one country's total for one disaster type in one year."
            ),
            "built_at": self.meta.get("built_at"),
            "currency": self.fx.describe() if self.fx else None,
        }

    # ── per type blocks ─────────────────────────────────────────────────
    def _human(self, recs: pd.DataFrame) -> dict:
        metrics = []
        for key, label, definition in HUMAN_METRICS:
            total = int(recs[key].sum())
            if total <= 0:
                continue
            metrics.append({
                "key": key, "label": label, "definition": definition, "value": total,
                "records_reporting": int((recs[key] > 0).sum()),
            })
        both = recs[(recs.deaths > 0) & (recs.total_affected > 0)]
        by_decade = recs.groupby("decade")[["deaths", "total_affected"]].sum().reset_index()
        return {
            "metrics": metrics,
            "fatality_rate": {
                "value_pct": _py(_ratio(both.deaths.sum(), both.total_affected.sum()) * 100) if len(both) else None,
                "median_pct": _py(both.fatality_rate_pct.median()) if len(both) else None,
                "records": int(len(both)),
                "definition": "Deaths ÷ total affected × 100, pooled over the records that report both.",
            },
            "by_decade": _rows(by_decade),
            "unavailable": HUMAN_UNAVAILABLE,
            "records": int(len(recs)),
            "source": SOURCES["emdat"],
        }

    def _economic(self, recs: pd.DataFrame) -> dict:
        damages = recs.damages_usd.sum()
        insured = recs.insured_usd.sum()
        reconstruction = recs.reconstruction_usd.sum()
        both = recs[(recs.damages_usd > 0) & (recs.total_affected > 0)]
        gdp = recs[recs.damages_pct_gdp > 0].sort_values("damages_pct_gdp", ascending=False)
        by_decade = recs.groupby("decade")[["damages_usd", "insured_usd", "damages_inr", "insured_inr"]].sum().reset_index()
        with_money = recs[recs.damages_nominal_usd > 0]
        return {
            "currency": "INR at each year's rate; US$ as reported",
            "total_damages_inr": _py(recs.damages_inr.sum()),
            "total_damages_nominal_usd": _py(recs.damages_nominal_usd.sum()),
            "insured_inr": _py(recs.insured_inr.sum()),
            "insured_nominal_usd": _py(recs.insured_nominal_usd.sum()),
            "reconstruction_inr": _py(recs.reconstruction_inr.sum()),
            "reconstruction_nominal_usd": _py(recs.reconstruction_nominal_usd.sum()),
            "insured_share_inr": _py(_ratio(recs.insured_inr.sum(), recs.damages_inr.sum())),
            "records_fx_estimated": int(with_money.fx_estimated.sum()),
            "loss_per_affected_inr": _py(_ratio(both.damages_inr.sum(), both.total_affected.sum())) if len(both) else None,
            "total_damages_usd": _py(damages),
            "insured_usd": _py(insured),
            "reconstruction_usd": _py(reconstruction),
            "insured_share": _py(_ratio(insured, damages)),
            "records_with_damages": int((recs.damages_usd > 0).sum()),
            "records_with_insured": int((recs.insured_usd > 0).sum()),
            "records_with_reconstruction": int((recs.reconstruction_usd > 0).sum()),
            "records": int(len(recs)),
            "loss_per_affected_usd": _py(_ratio(both.damages_usd.sum(), both.total_affected.sum())) if len(both) else None,
            "loss_per_affected_records": int(len(both)),
            "gdp": {
                "records": int(len(gdp)),
                "median_pct": _py(gdp.damages_pct_gdp.median()) if len(gdp) else None,
                "top": _rows(gdp.head(TOP_N), ["country", "year", "damages_pct_gdp", "damages_usd",
                                               "damages_inr", "damages_nominal_usd", "fx_estimated"]),
                "source": SOURCES["emdat_wdi"],
            },
            "by_decade": _rows(by_decade),
            "unavailable": ECONOMIC_UNAVAILABLE,
            "source": SOURCES["emdat"],
        }

    def _frequency(self, type_id: str) -> dict:
        world = self.world[self.world.type == type_id].sort_values("year")
        yearly = _rows(world, ["year", "n_events", "deaths", "total_affected", "damages_usd",
                               "damages_inr", "damages_nominal_usd", "fx_estimated"])
        decades = world.groupby("decade").agg(
            n_events=("n_events", "sum"), deaths=("deaths", "sum"),
            damages_usd=("damages_usd", "sum"), damages_inr=("damages_inr", "sum"),
            years=("year", "count"),
        ).reset_index()
        decades["events_per_year"] = decades.n_events / decades.years
        decades["complete"] = decades.years == 10
        decades["change_pct"] = [
            None if i == 0 else _pct_change(row.events_per_year, decades.events_per_year.iloc[i - 1])
            for i, row in enumerate(decades.itertuples())
        ]
        complete = decades[decades.complete]
        last_dec, prev_dec = complete.iloc[-1], complete.iloc[-2]
        last, prev = world.iloc[-1], world.iloc[-2]
        return {
            "yearly": yearly,
            "decades": _rows(decades),
            "yoy": {"year": int(last.year), "events": int(last.n_events), "previous_events": int(prev.n_events),
                    "change_pct": _pct_change(last.n_events, prev.n_events)},
            "dod": {"decade": int(last_dec.decade), "events": int(last_dec.n_events),
                    "previous_decade": int(prev_dec.decade), "previous_events": int(prev_dec.n_events),
                    "change_pct": _pct_change(last_dec.n_events, prev_dec.n_events)},
            "months": self._months(type_id),
            "usgs_decades": self._usgs_decades(type_id),
            "definition": EVENT_DEFINITION,
            "source": SOURCES["emdat"],
        }

    def _usgs_decades(self, type_id: str) -> list[dict] | None:
        """Earthquakes of every size the USGS catalogue holds (M6+), per decade, for comparison
        with EM-DAT's count of earthquake *disasters*. ``None`` for types with no point source."""
        if disaster_types.get(type_id).point_source != "usgs":
            return None
        quakes = self.earthquakes
        rows = quakes.groupby("decade").agg(m6=("magnitude", "size"), m7=("magnitude", lambda m: int((m >= 7).sum()))).reset_index()
        return _rows(rows)

    def _months(self, type_id: str) -> dict:
        point_source = disaster_types.get(type_id).point_source
        if point_source == "usgs":
            quakes = self.earthquakes
            result = seasonality(quakes.month)
            # Aftershock sequences (e.g. 73 M6+ quakes in March 2011) break the
            # χ² test's independence assumption. Re-test with one quake per
            # month per 5° cell; only a peak that survives both counts as a season.
            cells = (quakes.latitude // 5).astype(str) + "_" + (quakes.longitude // 5).astype(str)
            declustered = quakes.assign(cell=cells).drop_duplicates(["year", "month", "cell"])
            robust = seasonality(declustered.month)
            stable = robust["seasonal"] and robust["peak_season"]["label"] == result["peak_season"]["label"]
            result.update(
                source=SOURCES["usgs"], population="USGS M6+ earthquakes",
                first_year=int(quakes.year.min()),
                seasonal=bool(result["seasonal"] and stable),
                robustness={
                    "method": "one earthquake per month per 5° grid cell, to thin out aftershock sequences",
                    "n": robust["total"],
                    "peak_season": robust["peak_season"]["label"],
                    "p_value": robust["p_value"],
                    "stable": bool(stable),
                },
                note=(
                    "Earthquakes have no physical season. The raw monthly counts are uneven because "
                    "aftershock sequences cluster many quakes into one month; with aftershocks thinned, "
                    f"the busiest three months move from {result['peak_season']['label']} to "
                    f"{robust['peak_season']['label']}, so no season is claimed."
                ) if not stable else None,
            )
            return {"available": True, **result}
        if point_source == "ibtracs":
            storms = self.cyclones
            result = seasonality(storms.month)
            north = storms[storms.lmi_latitude >= 0].month.value_counts()
            south = storms[storms.lmi_latitude < 0].month.value_counts()
            for row in result["rows"]:
                row["north"] = int(north.get(row["month"], 0))
                row["south"] = int(south.get(row["month"], 0))
            result.update(source=SOURCES["ibtracs"], population="tropical cyclones (genesis month)",
                          first_year=int(storms.season.min()))
            return {"available": True, **result}
        return {
            "available": False,
            "reason": (
                "The sources used record this disaster type by country and year only, with no "
                "event dates, so there is no month to count."
            ),
        }

    def _geography(self, type_id: str, recs: pd.DataFrame) -> dict:
        by_country = recs.groupby(["country", "iso3"], dropna=False).agg(
            deaths=("deaths", "sum"), total_affected=("total_affected", "sum"),
            damages_usd=("damages_usd", "sum"), damages_inr=("damages_inr", "sum"),
            damages_nominal_usd=("damages_nominal_usd", "sum"), fx_estimated=("fx_estimated", "any"),
            records=("year", "count"),
            first_year=("year", "min"), last_year=("year", "max"),
            historical_state=("historical_state", "first"),
        ).reset_index()
        columns = ["country", "iso3", "deaths", "total_affected", "damages_usd", "damages_inr",
                   "damages_nominal_usd", "fx_estimated", "records"]

        def top(metric: str) -> list[dict]:
            rows = by_country[by_country[metric] > 0].sort_values(metric, ascending=False).head(TOP_N)
            return _rows(rows, columns)

        historical = by_country[by_country.historical_state]
        point_source = disaster_types.get(type_id).point_source
        points: dict[str, Any] = {"available": False}
        if point_source == "usgs":
            strong = self.earthquakes[self.earthquakes.magnitude >= 7]
            points = {
                "available": True, "source": SOURCES["usgs"], "size_by": "magnitude",
                "filter": "magnitude 7.0 and above", "count": int(len(strong)),
                "points": [[_py(r.latitude), _py(r.longitude), _py(r.magnitude), int(r.year), r.place]
                           for r in strong.itertuples()],
            }
        elif point_source == "ibtracs":
            major = self.cyclones[self.cyclones.category >= 3]
            points = {
                "available": True, "source": SOURCES["ibtracs"], "size_by": "max_wind_kt",
                "filter": "category 3 and above (lifetime-maximum-intensity position)",
                "count": int(len(major)),
                "points": [[_py(r.lmi_latitude), _py(r.lmi_longitude), int(r.max_wind_kt), int(r.season),
                            f"{r.name} ({r.season}), category {r.category}"] for r in major.itertuples()],
            }
        return {
            "countries_affected": int(len(by_country)),
            "top_affected": top("total_affected"),
            "top_deaths": top("deaths"),
            # Ranked by the ₹ figure shown, so the list reads in order.
            "top_loss": top("damages_inr"),
            "choropleth": _rows(by_country[~by_country.historical_state], columns),
            "historical_states": _rows(historical, columns),
            "points": points,
            "precision": "point" if point_source else "country",
            "unavailable": GEOGRAPHY_UNAVAILABLE,
            "source": SOURCES["emdat"],
        }

    def _severity(self, recs: pd.DataFrame, score_column: str) -> dict:
        ranked = recs.sort_values(score_column, ascending=False).head(SEVERITY_TOP_N)
        columns = ["type", "country", "year", "deaths", "total_affected", "damages_usd",
                   "damages_inr", "damages_nominal_usd", "fx_estimated", score_column]
        rows = _rows(ranked, columns)
        for row in rows:
            row["score"] = row.pop(score_column)
        return {
            "population": int(len(recs)),
            "weights": self.meta["severity_weights"],
            "method": (
                "For each record, deaths, total affected and damages are each put on a log scale "
                "(log10(1 + x)), min-max scaled to 0–1 across the records being ranked, then combined "
                "as 50% deaths + 25% affected + 25% economic loss and multiplied by 100. Economic loss "
                "enters in inflation-adjusted US$ (2024 prices), so years are comparable; the ₹ shown "
                "is that loss converted at the record's own year. A figure "
                "the source did not report counts as 0, so records without damage estimates can "
                "rank lower than they should."
            ),
            "top": rows,
            "source": SOURCES["emdat"],
        }

    def _time(self, type_id: str, frequency: dict) -> dict:
        world = self.world[self.world.type == type_id]
        decades = pd.DataFrame(frequency["decades"])
        recent = world[world.year >= TREND_FROM]

        def peak(metric: str) -> dict:
            row = decades.loc[decades[metric].idxmax()]
            return {"decade": int(row.decade), "value": _py(row[metric]), "complete": bool(row.complete),
                    "value_inr": _py(row["damages_inr"])}

        return {
            "peak_events_decade": peak("n_events"),
            "peak_deaths_decade": peak("deaths"),
            "peak_loss_decade": peak("damages_usd"),
            "frequency_trend": trend_verdict(recent.year, recent.n_events),
            "deaths_trend": trend_verdict(recent.year, recent.deaths),
            # Tested on inflation-adjusted US$: a trend in rupees-at-the-time would
            # mostly measure inflation and the rupee's depreciation.
            "loss_trend": {**trend_verdict(recent.year, recent.damages_usd), "basis": "inflation-adjusted US$ (2024 prices)"},
            "peak_loss_basis": "ranked on inflation-adjusted US$ (2024 prices)",
            "strongest_month": (
                {k: frequency["months"].get(k) for k in ("peak_month", "peak_season", "seasonal", "p_value", "source", "note")}
                if frequency["months"]["available"] else None
            ),
            "source": SOURCES["emdat"],
        }

    def _correlation(self, recs: pd.DataFrame) -> dict:
        pairs = [
            correlation(recs, "total_affected", "deaths"),
            correlation(recs, "total_affected", "damages_inr"),
            correlation(recs, "deaths", "damages_inr"),
        ]
        return {
            "pairs": pairs,
            "method": (
                "Each dot is a country-year record that reports both figures. Pearson r is computed on "
                "log10 values (the figures span several orders of magnitude); Spearman ρ is computed "
                "on ranks. Neither implies causation. Loss is in ₹ at each record's year (not "
                "inflation-adjusted)."
            ),
            "source": SOURCES["emdat"],
        }

    def _recovery(self, recs: pd.DataFrame) -> dict:
        """Recovery and resilience from what EM-DAT does record.

        * Reconstruction cost, for the few records that report it (with its
          share of the damage on those same records).
        * Resilience indicators by decade since 1980: deaths per 1,000 people
          affected and the median damage as a share of GDP. These are
          outcomes, not a recovery timeline.
        Recovery time and rebuilding progress are not in the sources and are
        listed as unavailable.
        """
        rec = recs[recs.reconstruction_usd > 0]
        both = rec[rec.damages_usd > 0]
        recon = {
            "records": int(len(rec)),
            "of_records": int(len(recs)),
            "total_inr": _py(rec.reconstruction_inr.sum()),
            "total_nominal_usd": _py(rec.reconstruction_nominal_usd.sum()),
            "share_of_damage": _py(_ratio(both.reconstruction_usd.sum(), both.damages_usd.sum())) if len(both) else None,
            "share_records": int(len(both)),
            "top": _rows(
                rec.sort_values("reconstruction_usd", ascending=False).head(5),
                ["country", "year", "reconstruction_inr", "reconstruction_nominal_usd", "damages_inr",
                 "damages_nominal_usd", "fx_estimated"],
            ),
        }
        last_year = int(recs.year.max())
        rows = []
        for decade, group in recs[recs.year >= TREND_FROM].groupby("decade"):
            pair = group[(group.deaths > 0) & (group.total_affected > 0)]
            gdp = group[group.damages_pct_gdp > 0]
            rows.append({
                "decade": int(decade),
                "records": int(len(group)),
                "records_with_both": int(len(pair)),
                "deaths": _py(pair.deaths.sum()),
                "total_affected": _py(pair.total_affected.sum()),
                "deaths_per_1000": _py(_ratio(pair.deaths.sum(), pair.total_affected.sum()) * 1000) if len(pair) else None,
                "median_damage_pct_gdp": _py(gdp.damages_pct_gdp.median()) if len(gdp) else None,
                "partial": bool(int(decade) + 9 > last_year),
            })
        full = [r for r in rows if not r["partial"] and r["deaths_per_1000"] is not None]
        verdict = None
        if len(full) >= 2:
            first, last = full[0], full[-1]
            change = (last["deaths_per_1000"] - first["deaths_per_1000"]) / first["deaths_per_1000"] * 100
            verdict = {
                "first_decade": first["decade"], "last_decade": last["decade"],
                "first": first["deaths_per_1000"], "last": last["deaths_per_1000"],
                "change_pct": _py(change),
            }
        return {
            "available": True,
            "reconstruction": recon,
            "resilience": {"decades": rows, "verdict": verdict},
            "unavailable": RECOVERY_UNAVAILABLE,
            "method": (
                "Deaths per 1,000 affected pools each decade's records that report both figures. A falling "
                "rate can mean better warning and shelter, but also more people being counted as affected; "
                "it is an outcome indicator, not a measure of recovery."
            ),
            "source": SOURCES["emdat"],
        }

    def build_type(self, type_id: str) -> dict:
        dtype = disaster_types.get(type_id)
        recs = self.records[self.records.type == type_id]
        frequency = self._frequency(type_id)
        return {
            "id": type_id,
            "label": dtype.label,
            "caveat": dtype.caveat,
            "coverage": {
                **self.coverage(),
                "records": int(len(recs)),
                "records_before_trend": int((recs.year < TREND_FROM).sum()),
                "records_first_year": int(recs.year.min()),
            },
            "human": self._human(recs),
            "economic": self._economic(recs),
            "frequency": frequency,
            "geography": self._geography(type_id, recs),
            "severity": self._severity(recs, "severity_type"),
            "time": self._time(type_id, frequency),
            "correlation": self._correlation(recs),
            "recovery": self._recovery(recs),
        }

    # ── overview ────────────────────────────────────────────────────────
    def build_overview(self) -> dict:
        comparison = []
        for dtype in disaster_types.DISASTER_TYPES:
            recs = self.records[self.records.type == dtype.id]
            events = int(self.world[self.world.type == dtype.id].n_events.sum())
            deaths = int(recs.deaths.sum())
            damages = float(recs.damages_usd.sum())
            damages_inr = float(recs.damages_inr.sum())
            top = recs.sort_values("severity_type", ascending=False).iloc[0]
            comparison.append({
                "id": dtype.id,
                "label": dtype.label,
                "events": events,
                "records": int(len(recs)),
                "deaths": deaths,
                "total_affected": int(recs.total_affected.sum()),
                "damages_usd": damages,
                "countries": int(recs.country.nunique()),
                "avg_deaths_per_event": _ratio(deaths, events),
                "avg_loss_per_event_usd": _ratio(damages, events),
                "damages_inr": damages_inr,
                "damages_nominal_usd": float(recs.damages_nominal_usd.sum()),
                "avg_loss_per_event_inr": _ratio(damages_inr, events),
                "worst_record": {"country": top.country, "year": int(top.year), "deaths": int(top.deaths)},
            })

        world = self.world.groupby("year").agg(
            n_events=("n_events", "sum"), deaths=("deaths", "sum"), total_affected=("total_affected", "sum"),
            damages_usd=("damages_usd", "sum"), damages_inr=("damages_inr", "sum"),
            damages_nominal_usd=("damages_nominal_usd", "sum"), fx_estimated=("fx_estimated", "any"),
        ).reset_index()
        recent = world[world.year >= TREND_FROM]
        decades = world.assign(decade=(world.year // 10) * 10).groupby("decade").agg(
            n_events=("n_events", "sum"), deaths=("deaths", "sum"), damages_usd=("damages_usd", "sum"),
            damages_inr=("damages_inr", "sum"), years=("year", "count"),
        ).reset_index()
        decades["complete"] = decades.years == 10
        return {
            "coverage": {**self.coverage(), "records": int(len(self.records))},
            "comparison": comparison,
            "comparison_note": (
                "Disasters: EM-DAT disaster counts (world), not every occurrence of the hazard: an event is "
                "listed only if it killed 10+ people, affected 100+, led to a state of emergency or an appeal for "
                "international aid. Deaths, affected, loss and countries: sums over "
                "country-year records. Averages divide the totals by the disaster count. Loss: each record's "
                "as-reported US$ converted to ₹ at that year's average rate, then summed."
            ),
            "top_severity": self._severity(self.records, "severity_all"),
            "global_trend": {
                "yearly": _rows(world),
                "decades": _rows(decades),
                "deaths_trend": trend_verdict(recent.year, recent.deaths),
                "loss_trend": {**trend_verdict(recent.year, recent.damages_usd),
                               "basis": "inflation-adjusted US$ (2024 prices)"},
                "events_trend": trend_verdict(recent.year, recent.n_events),
                "types": disaster_types.IDS,
                "source": SOURCES["emdat"],
            },
            "sources": list(SOURCES.values()),
        }

    # ── historical map ──────────────────────────────────────────────────
    def decades(self) -> list[int]:
        return sorted({int(d) for d in self.records.decade.unique()})

    def map_layer(self, type_id: str, decade: int) -> dict:
        dtype = disaster_types.get(type_id)
        if dtype.point_source == "usgs":
            quakes = self.earthquakes[self.earthquakes.decade == decade]
            return {
                "type": type_id, "precision": "point", "source": SOURCES["usgs"], "size_by": "magnitude",
                "available": True, "count": int(len(quakes)),
                "points": [
                    {"id": r.id, "latitude": _py(r.latitude), "longitude": _py(r.longitude),
                     "year": int(r.year), "date": r.time[:10], "title": r.place or "Unknown location",
                     "magnitude": _py(r.magnitude), "value": _py(r.magnitude)}
                    for r in quakes.itertuples()
                ],
            }
        if dtype.point_source == "ibtracs":
            storms = self.cyclones[self.cyclones.decade == decade]
            available = decade + 9 >= int(self.meta["ibtracs_first_season"])
            return {
                "type": type_id, "precision": "point", "source": SOURCES["ibtracs"], "size_by": "max_wind_kt",
                "available": available,
                "reason": None if available else
                f"The IBTrACS layer starts in {self.meta['ibtracs_first_season']} (satellite era).",
                "count": int(len(storms)),
                "points": [
                    {"id": r.sid, "latitude": _py(r.lmi_latitude), "longitude": _py(r.lmi_longitude),
                     "year": int(r.season), "date": r.genesis_date, "title": f"{r.name} ({r.basin} basin)",
                     "max_wind_kt": int(r.max_wind_kt), "category": int(r.category),
                     "landfall": bool(r.landfall), "value": int(r.max_wind_kt)}
                    for r in storms.itertuples()
                ],
            }
        recs = self.records[(self.records.type == type_id) & (self.records.decade == decade)]
        recs = recs.merge(self.countries[["country", "latitude", "longitude"]], on="country", how="left")
        unmapped = recs[recs.latitude.isna()]
        grouped = recs.dropna(subset=["latitude"]).sort_values("severity_type", ascending=False).groupby("country")
        points = []
        for country, group in grouped:
            worst = group.iloc[0]
            points.append({
                "id": f"{type_id}-{country}-{decade}", "latitude": _py(worst.latitude),
                "longitude": _py(worst.longitude), "year": int(worst.year), "title": country,
                "records": int(len(group)), "deaths": int(group.deaths.sum()),
                "total_affected": int(group.total_affected.sum()), "damages_usd": _py(group.damages_usd.sum()),
                "damages_inr": _py(group.damages_inr.sum()),
                "severity": _py(worst.severity_type), "value": _py(worst.severity_type),
            })
        return {
            "type": type_id, "precision": "country", "source": SOURCES["emdat"], "size_by": "severity",
            "available": True, "count": len(points),
            "unmapped": sorted(unmapped.country.unique().tolist()),
            "points": sorted(points, key=lambda p: -(p["severity"] or 0)),
        }

    def map_payload(self, decade: int, types: list[str]) -> dict:
        return {
            "decade": decade,
            "decades": self.decades(),
            "layers": {type_id: self.map_layer(type_id, decade) for type_id in types},
            "coverage": self.coverage(),
        }


def build_history(tables: dict) -> History:
    """Precompute every per-type payload and the overview."""
    fx = FxTable.from_frame(tables["fx_inr"])
    history = History(
        records=add_inr(tables["impact_records"], fx, INR_PAIRS),
        world=add_inr(tables["world_yearly"], fx, INR_PAIRS),
        earthquakes=tables["earthquakes"],
        cyclones=tables["cyclones"],
        countries=tables["countries"],
        meta=tables["meta"],
        fx=fx,
    )
    history.types = {type_id: history.build_type(type_id) for type_id in disaster_types.IDS}
    history.overview = history.build_overview()
    return history
