"""US$ → ₹ conversion at each record's own year, for display only.

Stored money stays in US$. The rate table is the World Bank's official
exchange rate for India (WDI ``PA.NUS.FCRF``: rupees per US$, annual period
average, from IMF International Financial Statistics), fetched once by
``backend/data_pipeline.py`` into ``backend/data/clean/fx_inr_per_usd.csv``.

What gets converted is EM-DAT's figure *as reported for the event year*
(nominal US$), multiplied by that year's average rate: "rupees at the time".
The result is not adjusted for inflation. A year outside the table uses the
nearest year that has a rate and is flagged, so the UI can say so.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

SOURCE = {
    "name": "World Bank WDI (PA.NUS.FCRF), from IMF International Financial Statistics",
    "series": "Official exchange rate, rupees per US$, annual period average",
    "url": "https://data.worldbank.org/indicator/PA.NUS.FCRF?locations=IN",
}

NOTE = "Converted from USD using that year's average exchange rate. Not adjusted for inflation."
NEAREST_NOTE = "Converted using nearest available year's exchange rate."


@dataclass(frozen=True)
class FxTable:
    """Rupees per US$ by year, with nearest-year fallback."""

    years: np.ndarray
    rates: np.ndarray

    @classmethod
    def from_frame(cls, frame: pd.DataFrame) -> "FxTable":
        frame = frame.dropna().sort_values("year")
        return cls(frame.year.to_numpy(dtype=int), frame.inr_per_usd.to_numpy(dtype=float))

    @property
    def first_year(self) -> int:
        return int(self.years[0])

    @property
    def last_year(self) -> int:
        return int(self.years[-1])

    def source_years(self, years) -> np.ndarray:
        """For each year, the table year whose rate is used (itself, or the nearest)."""
        years = np.asarray(years, dtype=int)
        index = np.abs(self.years[None, :] - years[:, None]).argmin(axis=1)
        return self.years[index]

    def rate(self, year: int) -> tuple[float, int]:
        """(rupees per US$, table year used) for one year."""
        source_year = int(self.source_years([year])[0])
        return float(self.rates[self.years == source_year][0]), source_year

    def to_inr(self, usd, years) -> tuple[np.ndarray, np.ndarray]:
        """Convert US$ amounts at their own years' rates; also return an "estimated rate" flag."""
        source = self.source_years(years)
        lookup = dict(zip(self.years.tolist(), self.rates.tolist()))
        rates = np.array([lookup[int(y)] for y in source])
        return np.asarray(usd, dtype=float) * rates, source != np.asarray(years, dtype=int)

    def describe(self) -> dict:
        return {
            **SOURCE,
            "first_year": self.first_year,
            "last_year": self.last_year,
            "note": NOTE,
            "nearest_note": NEAREST_NOTE,
            "rates": {int(y): round(float(r), 4) for y, r in zip(self.years, self.rates)},
        }


def add_inr(frame: pd.DataFrame, fx: FxTable, pairs: dict[str, str], year_column: str = "year") -> pd.DataFrame:
    """Add ₹ columns (``pairs``: nominal US$ column → ₹ column) and ``fx_estimated``."""
    frame = frame.copy()
    estimated = np.zeros(len(frame), dtype=bool)
    for usd_column, inr_column in pairs.items():
        inr, flag = fx.to_inr(frame[usd_column].fillna(0), frame[year_column])
        frame[inr_column] = inr
        estimated |= flag & (frame[usd_column].fillna(0).to_numpy() > 0)
    frame["fx_estimated"] = estimated
    return frame
