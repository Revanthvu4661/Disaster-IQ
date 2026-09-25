"""US$ → ₹ display conversion: per-year rates, nearest-year fallback, totals."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.currency import FxTable, add_inr

FX = FxTable.from_frame(pd.DataFrame({"year": [1960, 2000, 2010], "inr_per_usd": [4.76, 44.94, 45.73]}))


def test_each_record_uses_its_own_year() -> None:
    inr, estimated = FX.to_inr([1.0, 1.0], [2000, 2010])
    assert inr.tolist() == pytest.approx([44.94, 45.73])
    assert estimated.tolist() == [False, False]


def test_missing_years_use_the_nearest_rate_and_are_flagged() -> None:
    assert FX.rate(1931) == (4.76, 1960)
    assert FX.rate(2004) == (44.94, 2000)
    _, estimated = FX.to_inr([1.0], [1931])
    assert estimated.tolist() == [True]


def test_add_inr_flags_only_records_with_money() -> None:
    frame = pd.DataFrame({"year": [1931, 1931, 2010], "damages_nominal_usd": [10.0, 0.0, 2.0]})
    out = add_inr(frame, FX, {"damages_nominal_usd": "damages_inr"})
    assert out.damages_inr.tolist() == pytest.approx([47.6, 0.0, 91.46])
    assert out.fx_estimated.tolist() == [True, False, False]


def test_real_table_matches_published_rates(tables: dict) -> None:
    """World Bank / IMF annual averages; RBI's reference rates agree to within 1%."""
    fx = FxTable.from_frame(tables["fx_inr"])
    assert fx.first_year == 1960
    assert fx.rate(2001)[0] == pytest.approx(47.19, rel=0.01)
    assert fx.rate(2013)[0] == pytest.approx(58.60, rel=0.01)


def test_totals_are_sums_of_per_year_conversions(history) -> None:
    recs = history.records[history.records.type == "earthquake"]
    expected = float(np.sum(recs.damages_nominal_usd * [history.fx.rate(int(y))[0] for y in recs.year]))
    assert history.types["earthquake"]["economic"]["total_damages_inr"] == pytest.approx(expected)
    haiti = recs[(recs.country == "Haiti") & (recs.year == 2010)].iloc[0]
    assert haiti.damages_inr == pytest.approx(8e9 * history.fx.rate(2010)[0])
