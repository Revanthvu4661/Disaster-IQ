"""Event frequency by year, month and day for each disaster type.

Counts events on the dates the sources give, and never estimates a date:

* earthquakes: USGS M6+ catalogue, one row per earthquake (``time``);
* cyclones: NOAA IBTrACS, one row per storm, dated by genesis (``genesis_date``);
* floods: EM-DAT (via OWID) has yearly counts worldwide but no dates, so months
  and days come from the India Flood Inventory (IFI, India only), counting each
  event once on its resolved start date;
* if the full EM-DAT export ``backend/data/raw/emdat_public.xlsx`` is present,
  its Start Year / Month / Day are used for all three types worldwide instead.
  Records with no start month drop out of the monthly view and records with no
  start day out of the daily view, and the counts dropped are reported.

Decade analysis lives in ``history._frequency`` and is not repeated here.
"""

from __future__ import annotations

import calendar
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd

from backend.config import DATA_DIR

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
TREND_FROM = 1980
USGS_COMPLETE_FROM = 1973        # M6+ is reasonably complete from the global digital network onwards
EMDAT_COMPLETE_FROM = 1980       # EM-DAT reporting improves sharply around 1980
DECLUSTER_CELL_DEG = 5
TOP_DAYS = 5
EVENTS_LISTED = 8
EMDAT_XLSX = DATA_DIR / "raw" / "emdat_public.xlsx"
IFI_DATES_CSV = DATA_DIR / "clean" / "flood" / "ifi_event_dates.csv"

EMDAT_TYPES = {"earthquake": "Earthquake", "flood": "Flood", "cyclone": "Storm"}


# ── small helpers ───────────────────────────────────────────────────────────


def _py(value: Any) -> Any:
    return value.item() if hasattr(value, "item") else value


def _unavailable(reason: str, source: dict | None = None) -> dict:
    return {"available": False, "reason": reason, "source": source}


def _limits(events: pd.DataFrame, first_year: int, last_year: int) -> pd.DataFrame:
    return events[(events["date"].dt.year >= first_year) & (events["date"].dt.year <= last_year)]


def yearly_series(counts: pd.Series, *, series_id: str, label: str, kind: str, source: dict, poor_before: int | None,
                  trend: Callable[[pd.Series, pd.Series], dict], note: str | None = None) -> dict:
    """One line of the yearly chart: events per year, every year in range (zero when none), and a trend from 1980."""
    years = pd.Series(range(int(counts.index.min()), int(counts.index.max()) + 1))
    values = pd.Series(counts.reindex(years.values, fill_value=0).astype(int).values, index=years.index)
    since = years >= TREND_FROM
    return {
        "id": series_id,
        "label": label,
        "kind": kind,
        "source": source,
        "first_year": int(years.min()),
        "last_year": int(years.max()),
        "n_events": int(values.sum()),
        "poor_before": poor_before,
        "rows": [{"year": int(y), "count": int(c)} for y, c in zip(years, values)],
        "trend": trend(years[since], values[since]),
        "note": note,
    }


# ── monthly ─────────────────────────────────────────────────────────────────


def monthly_block(events: pd.DataFrame, first_year: int, last_year: int, source: dict, *, scope: str, unit: str,
                  dropped: int = 0, note: str | None = None) -> dict:
    """Year x month counts (for a heatmap), the average per month and the busiest month on record."""
    events = _limits(events, first_year, last_year)
    if events.empty:
        return _unavailable("No dated events in this source.", source)
    table = events.groupby([events["date"].dt.year, events["date"].dt.month]).size()
    years = list(range(first_year, last_year + 1))
    matrix = [[int(table.get((y, m), 0)) for m in range(1, 13)] for y in years]
    totals = np.array(matrix).sum(axis=0)
    best = max(((y, m, matrix[i][m - 1]) for i, y in enumerate(years) for m in range(1, 13)), key=lambda t: t[2])
    calendar_best = int(totals.argmax()) + 1
    return {
        "available": True,
        "source": source,
        "scope": scope,
        "unit": unit,
        "first_year": first_year,
        "last_year": last_year,
        "n_events": int(len(events)),
        "dropped": dropped,
        "years": years,
        "matrix": matrix,
        "average_per_month": [
            {"month": m, "label": MONTHS[m - 1], "average": round(float(totals[m - 1] / len(years)), 3),
             "total": int(totals[m - 1])} for m in range(1, 13)
        ],
        "busiest_month_on_record": {"year": best[0], "month": best[1], "label": f"{MONTHS[best[1] - 1]} {best[0]}",
                                    "count": best[2]},
        "busiest_calendar_month": {"month": calendar_best, "label": MONTHS[calendar_best - 1],
                                   "average": round(float(totals[calendar_best - 1] / len(years)), 3),
                                   "share": round(float(totals[calendar_best - 1] / totals.sum()), 4)},
        "note": note,
    }


# ── daily ───────────────────────────────────────────────────────────────────


def _day_stats(events: pd.DataFrame, first_year: int, last_year: int) -> dict:
    period_days = (pd.Timestamp(last_year, 12, 31) - pd.Timestamp(first_year, 1, 1)).days + 1
    per_day = events.groupby("date").size()
    order = per_day.sort_values(ascending=False, kind="stable")
    # Ties go to the earlier date, so the answer does not depend on row order.
    order = order.reset_index().sort_values([0, "date"], ascending=[False, True])

    def day(date: pd.Timestamp, count: int) -> dict:
        same = events[events["date"] == date].sort_values("rank", ascending=False)
        labels = same["label"].tolist()
        return {"date": date.date().isoformat(), "count": int(count), "events": labels[:EVENTS_LISTED],
                "more": max(0, len(labels) - EVENTS_LISTED)}

    top = [day(row["date"], row[0]) for _, row in order.head(TOP_DAYS).iterrows()]
    doy = np.zeros(366, dtype=int)
    for date, count in per_day.items():
        month_day = (date.month, date.day)
        # Position in a leap year, so 29 February has its own slot and every date keeps the same place.
        doy[pd.Timestamp(2000, *month_day).dayofyear - 1] += int(count)
    by_year: dict[str, list[list[int]]] = {}
    for date, count in per_day.items():
        by_year.setdefault(str(date.year), []).append([int(date.dayofyear), int(count)])
    return {
        "period_days": int(period_days),
        "days_with_event": int(len(per_day)),
        "share_days_with_event": round(float(len(per_day) / period_days), 4),
        "average_per_day": round(float(len(events) / period_days), 4),
        "busiest_day": top[0],
        "top_days": top,
        "day_of_year": [int(v) for v in doy],
        "by_year": by_year,
    }


def daily_block(events: pd.DataFrame, first_year: int, last_year: int, source: dict, *, scope: str, unit: str,
                dropped: int = 0, note: str | None = None, declustered: dict | None = None) -> dict:
    """Average per day, share of days with an event, the busiest day, day-of-year counts and per-year daily counts."""
    events = _limits(events, first_year, last_year)
    if events.empty:
        return _unavailable("No dated events in this source.", source)
    years = list(range(first_year, last_year + 1))
    return {
        "available": True,
        "source": source,
        "scope": scope,
        "unit": unit,
        "first_year": first_year,
        "last_year": last_year,
        "n_events": int(len(events)),
        "dropped": dropped,
        "years": years,
        "default_year": last_year,
        **_day_stats(events, first_year, last_year),
        "declustered": declustered,
        "note": note,
    }


def decluster(quakes: pd.DataFrame) -> pd.DataFrame:
    """One earthquake per day per 5-degree cell (the largest), to thin out aftershock sequences."""
    cells = (quakes["lat"] // DECLUSTER_CELL_DEG).astype(int).astype(str) + "_" + (
        quakes["lon"] // DECLUSTER_CELL_DEG).astype(int).astype(str)
    ordered = quakes.assign(cell=cells).sort_values("rank", ascending=False, kind="stable")
    return ordered.drop_duplicates(["date", "cell"]).sort_values(["date", "rank"], ascending=[True, False])


# ── loading the dated events ────────────────────────────────────────────────


def earthquake_events(quakes: pd.DataFrame) -> pd.DataFrame:
    date = pd.to_datetime(quakes["time"], utc=True).dt.tz_localize(None).dt.normalize()
    place = quakes["place"].fillna("unknown place")
    return pd.DataFrame({
        "date": date, "rank": quakes["magnitude"].astype(float),
        "lat": quakes["latitude"].astype(float), "lon": quakes["longitude"].astype(float),
        "label": "M" + quakes["magnitude"].map(lambda m: f"{m:.1f}") + " " + place,
    })


def cyclone_events(storms: pd.DataFrame) -> pd.DataFrame:
    date = pd.to_datetime(storms["genesis_date"]).dt.normalize()
    return pd.DataFrame({
        "date": date, "rank": storms["max_wind_kt"].astype(float),
        "label": storms["name"].fillna("UNNAMED").astype(str).str.title() + " (" + storms["max_wind_kt"].astype(int).astype(str)
        + " kt peak)",
    })


def ifi_events(path: Path = IFI_DATES_CSV) -> pd.DataFrame | None:
    if not path.exists():
        return None
    ifi = pd.read_csv(path)
    date = pd.to_datetime(ifi["start"]).dt.normalize()
    where = ifi["state"].where(ifi["state"] != "", "India")
    return pd.DataFrame({
        "date": date, "rank": ifi["deaths"].fillna(0).astype(float),
        "label": where + " (" + ifi["uei"].str.replace("UEI-IMD-FL-", "IFI ", regex=False) + ")",
    })


def emdat_events(frame: pd.DataFrame, type_id: str) -> dict[str, Any]:
    """Dated EM-DAT records of one type from the full public export.

    Returns the events with a complete start date plus how many records were
    dropped for lacking a start month (monthly view) or start day (daily view).
    """
    part = frame[frame["Disaster Type"] == EMDAT_TYPES[type_id]]
    if type_id == "cyclone" and "Disaster Subtype" in part:
        part = part[part["Disaster Subtype"].fillna("").str.contains("Tropical cyclone", case=False)]
    year = pd.to_numeric(part["Start Year"], errors="coerce")
    month = pd.to_numeric(part["Start Month"], errors="coerce")
    day = pd.to_numeric(part["Start Day"], errors="coerce")
    with_month = part[year.notna() & month.notna()]
    monthly = pd.DataFrame({"date": pd.to_datetime(dict(year=year[with_month.index], month=month[with_month.index], day=1)),
                            "rank": 0.0, "label": with_month.get("Country", pd.Series("", index=with_month.index)).astype(str)})
    with_day = part[year.notna() & month.notna() & day.notna()]
    daily = pd.DataFrame({
        "date": pd.to_datetime(dict(year=year[with_day.index], month=month[with_day.index], day=day[with_day.index]),
                               errors="coerce"),
        "rank": pd.to_numeric(with_day.get("Total Deaths", 0), errors="coerce").fillna(0),
        "label": with_day.get("Country", pd.Series("", index=with_day.index)).astype(str),
    }).dropna(subset=["date"])
    return {"monthly": monthly, "daily": daily, "records": int(len(part)),
            "dropped_monthly": int(len(part) - len(monthly)), "dropped_daily": int(len(part) - len(daily))}


def load_emdat_frame(path: Path = EMDAT_XLSX) -> pd.DataFrame | None:
    """The full EM-DAT public export, when it has been placed in ``backend/data/raw/``."""
    if not path.exists():
        return None
    frame = pd.read_excel(path)
    needed = {"Disaster Type", "Start Year", "Start Month", "Start Day"}
    if not needed <= set(frame.columns):
        raise ValueError(f"{path.name} lacks columns: {', '.join(sorted(needed - set(frame.columns)))}")
    return frame


# ── one disaster type ───────────────────────────────────────────────────────

IFI_FIRST_YEAR = 1967
IFI_LAST_YEAR = 2023
IFI_SOURCE = {
    "id": "ifi",
    "name": "India Flood Inventory",
    "detail": "India Flood Inventory v3.0 (IIT Delhi HydroSense Lab, from IMD reports): India only, events 1967-2023",
    "url": "https://github.com/hydrosenselab/India-Flood-Inventory",
}
EMDAT_PUBLIC_SOURCE = {
    "id": "emdat_public",
    "name": "EM-DAT public export",
    "detail": "EM-DAT (CRED / UCLouvain) event list with Start Year, Month and Day, worldwide",
    "url": "https://public.emdat.be/",
}


def complete_through(dates: pd.Series, last_year: int) -> int:
    """The last year a dated source covers through December: a final year that stops before 1 December is left out."""
    latest = dates.max()
    return last_year - 1 if latest.year == last_year and latest < pd.Timestamp(last_year, 12, 1) else last_year


def build(type_id: str, *, world: pd.DataFrame, quakes: pd.DataFrame | None, storms: pd.DataFrame | None,
          ifi: pd.DataFrame | None, emdat: pd.DataFrame | None, last_year: int, sources: dict,
          trend: Callable[[pd.Series, pd.Series], dict]) -> dict:
    """The ``event_counts`` block of one disaster type: yearly, monthly and daily counts."""
    emdat_world = world[world["type"] == type_id].set_index("year")["n_events"]
    series = [yearly_series(
        emdat_world, series_id="emdat", label="Disasters recorded in EM-DAT (worldwide)", kind="disaster",
        source=sources["emdat"], poor_before=EMDAT_COMPLETE_FROM, trend=trend,
        note="EM-DAT counts disasters that met its reporting thresholds, one record per country and event, so it "
             "is not a count of physical events.")]
    events: pd.DataFrame | None = None
    physical_source: dict | None = None
    first_year, end_year = 0, last_year
    scope, unit = "worldwide", "events"
    note: str | None = None
    if type_id == "earthquake" and quakes is not None:
        events = earthquake_events(quakes)
        physical_source, first_year = sources["usgs"], int(events["date"].dt.year.min())
        unit = "earthquakes of magnitude 6.0 or larger"
    elif type_id == "cyclone" and storms is not None:
        events = cyclone_events(storms)
        physical_source, first_year = sources["ibtracs"], int(events["date"].dt.year.min())
        end_year = complete_through(events["date"], last_year)
        unit = "tropical cyclones, dated by genesis"
        if end_year < last_year:
            note = (f"{last_year} is left out: the IBTrACS record ends on {events['date'].max().date().isoformat()} "
                    f"and holds only {int((events['date'].dt.year == last_year).sum())} storms for {last_year}, "
                    "so counting it would understate the year.")
    elif type_id == "flood" and ifi is not None:
        events = ifi
        physical_source, first_year, end_year = IFI_SOURCE, IFI_FIRST_YEAR, IFI_LAST_YEAR
        scope, unit = "India only", "flood events, each counted once on its start date"
        note = ("India only. IFI records many more events in recent years (600 to 1,100 a year since 2022 "
                "against a few dozen a year before 1990), so its counts reflect reporting as much as floods, and "
                "no trend is claimed.")

    if type_id != "flood" and events is not None:
        physical = events[events["date"].dt.year.between(first_year, end_year)]
        series.insert(0, yearly_series(
            physical.groupby(physical["date"].dt.year).size(),
            series_id="physical",
            label={"earthquake": "Earthquakes M6+ (USGS)", "cyclone": "Tropical cyclones (IBTrACS)"}[type_id],
            kind="physical", source=physical_source,
            poor_before=USGS_COMPLETE_FROM if type_id == "earthquake" else None, trend=trend,
            note="Every earthquake of magnitude 6.0 or larger in the USGS catalogue, aftershocks included."
            if type_id == "earthquake" else "Storms that reached tropical-storm strength, by year of formation."))

    yearly = {
        "available": True,
        "source": series[0]["source"],
        "first_year": min(s["first_year"] for s in series),
        "last_year": max(s["last_year"] for s in series),
        "n_events": series[0]["n_events"],
        "series": series,
        "trend_from": TREND_FROM,
        "note": note if type_id == "cyclone" else None,
    }

    monthly: dict
    daily: dict
    if emdat is not None:
        dated = emdat_events(emdat, type_id)
        span = (int(dated["monthly"]["date"].dt.year.min()), last_year) if len(dated["monthly"]) else (1900, last_year)
        monthly = monthly_block(
            dated["monthly"], span[0], span[1], EMDAT_PUBLIC_SOURCE, scope="worldwide", unit="EM-DAT disasters",
            dropped=dated["dropped_monthly"],
            note=f"{dated['dropped_monthly']:,} of {dated['records']:,} records have no start month and are left out.")
        daily = daily_block(
            dated["daily"], span[0], span[1], EMDAT_PUBLIC_SOURCE, scope="worldwide", unit="EM-DAT disasters",
            dropped=dated["dropped_daily"],
            note=f"{dated['dropped_daily']:,} of {dated['records']:,} records have no start day and are left out.")
    elif events is None:
        reason = ("This source has no event dates: the India Flood Inventory file is missing, and EM-DAT (via Our "
                  "World in Data) gives flood counts by country and year only.")
        monthly, daily = _unavailable(reason), _unavailable(reason)
    else:
        monthly = monthly_block(events, first_year, end_year, physical_source, scope=scope, unit=unit, note=note)
        extra = None
        if type_id == "earthquake":
            thinned = decluster(events[events["date"].dt.year.between(first_year, end_year)])
            extra = {
                "method": "one earthquake per day per 5-degree cell (the largest)",
                "why": "Aftershocks are not separate events: one large earthquake is followed by dozens of M6+ shocks "
                       "in the same area over days, which inflates the busiest days.",
                "n_events": int(len(thinned)),
                **_day_stats(thinned, first_year, end_year),
            }
        daily = daily_block(events, first_year, end_year, physical_source, scope=scope, unit=unit, note=note,
                            declustered=extra)
    return {"yearly": yearly, "monthly": monthly, "daily": daily}
