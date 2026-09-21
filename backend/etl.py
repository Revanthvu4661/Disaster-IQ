"""ETL pipeline: raw CSVs -> cleaned DataFrame -> SQLite.

Run standalone:  python -m backend.etl
Or import:       from backend.etl import load_clean_data

The cleaned table adds four derived columns on top of the raw data:

``is_irrelevant``
    1 when the raw ``related`` value was 2, which the Figure-Eight
    documentation marks as non-disaster noise. These rows are kept (they are a
    real data-quality signal) but excluded from category and urgency stats.
``event`` / ``event_method``
    inferred disaster event and how it was inferred (see ``services.events``).
``message_length``
    character count, used by the text-analytics panel.
"""

from __future__ import annotations

import logging
import re
import sqlite3
from pathlib import Path

import pandas as pd

from backend.config import DATA_DIR, get_settings
from backend.services.events import infer_events

logger = logging.getLogger(__name__)

RAW_DIR = DATA_DIR
MESSAGES_CSV = RAW_DIR / "disaster_messages.csv"
CATEGORIES_CSV = RAW_DIR / "disaster_categories.csv"
TABLE_NAME = "messages"

#: The 36 canonical Figure-Eight category names, in dataset order.
CATEGORY_NAMES: list[str] = [
    "related", "request", "offer", "aid_related", "medical_help",
    "medical_products", "search_and_rescue", "security", "military",
    "child_alone", "water", "food", "shelter", "clothing", "money",
    "missing_people", "refugees", "death", "other_aid",
    "infrastructure_related", "transport", "buildings", "electricity",
    "tools", "hospitals", "shops", "aid_centers", "other_infrastructure",
    "weather_related", "floods", "storm", "fire", "earthquake", "cold",
    "other_weather", "direct_report",
]

#: Categories excluded from "what people need" style aggregations because they
#: describe the message rather than a need.
META_CATEGORIES: set[str] = {"related", "request", "offer", "direct_report", "aid_related"}


def db_path() -> Path:
    """Path of the SQLite cache, honouring ``DB_PATH``."""
    return get_settings().db_path


def parse_categories(cat_series: pd.Series) -> pd.DataFrame:
    """Split ``'related-1;request-0;...'`` strings into binary integer columns.

    ``related`` may legitimately be 2, meaning "not disaster related". That is
    preserved as an ``is_irrelevant`` flag and the ``related`` column itself is
    set to 0 for those rows (they are not related to a disaster), instead of
    being silently clipped to 1.
    """
    split = cat_series.astype(str).str.split(";", expand=True)
    split.columns = [re.sub(r"-\d+$", "", str(x)) for x in split.iloc[0]]

    for col in split.columns:
        values = split[col].astype(str).str.extract(r"-(\d+)$")[0]
        split[col] = pd.to_numeric(values, errors="coerce").fillna(0).astype(int)

    if "related" in split.columns:
        split["is_irrelevant"] = (split["related"] == 2).astype(int)
        # related == 2 means "not disaster related" -> treat the binary label as 0.
        split["related"] = (split["related"] == 1).astype(int)
    else:  # pragma: no cover - defensive, the dataset always has `related`
        split["is_irrelevant"] = 0

    for col in split.columns:
        if col != "is_irrelevant":
            split[col] = split[col].clip(0, 1)

    return split


def build_clean_data() -> pd.DataFrame:
    """Read the raw CSVs, clean, derive columns and return the DataFrame."""
    logger.info("ETL: reading raw CSVs from %s", RAW_DIR)
    messages = pd.read_csv(MESSAGES_CSV)
    categories = pd.read_csv(CATEGORIES_CSV)

    # The raw files contain 68 duplicated ids; merging without dedup would
    # produce a cartesian blow-up of 26,386 rows for 26,180 messages.
    messages = messages.drop_duplicates(subset=["id"], keep="first")
    categories = categories.drop_duplicates(subset=["id"], keep="first")

    df = messages.merge(categories, on="id", how="inner")
    raw_rows = len(df)

    cat_df = parse_categories(df["categories"])
    df = pd.concat([df.drop(columns=["categories"]), cat_df], axis=1)

    df = df.dropna(subset=["message"])
    before = len(df)
    df = df.drop_duplicates(subset=["message"], keep="first")
    duplicates_removed = before - len(df)

    df["genre"] = df["genre"].fillna("unknown").str.strip().str.lower()
    df["message"] = df["message"].astype(str).str.strip()
    df = df[df["message"].str.len() > 0]
    df["message_length"] = df["message"].str.len()

    events = infer_events(df)
    df = pd.concat([df, events], axis=1)

    df = df.reset_index(drop=True)
    df.attrs["raw_rows"] = raw_rows
    df.attrs["duplicates_removed"] = duplicates_removed
    logger.info(
        "ETL: %s rows (%s duplicates removed, %s irrelevant)",
        f"{len(df):,}", f"{duplicates_removed:,}", int(df["is_irrelevant"].sum()),
    )
    return df


def save_to_sqlite(df: pd.DataFrame, path: Path | None = None) -> Path:
    """Persist the cleaned frame plus an ETL metadata row to SQLite."""
    target = Path(path or db_path())
    target.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(target) as conn:
        df.to_sql(TABLE_NAME, conn, if_exists="replace", index=False)
        meta = pd.DataFrame(
            [
                {"key": "raw_rows", "value": str(df.attrs.get("raw_rows", len(df)))},
                {
                    "key": "duplicates_removed",
                    "value": str(df.attrs.get("duplicates_removed", 0)),
                },
                {"key": "rows", "value": str(len(df))},
            ]
        )
        meta.to_sql("etl_meta", conn, if_exists="replace", index=False)
    logger.info("ETL: saved to %s", target)
    return target


def load_clean_data(force_rebuild: bool = False, path: Path | None = None) -> pd.DataFrame:
    """Return the cleaned DataFrame, rebuilding the SQLite cache when needed.

    The cache is rebuilt automatically when it is missing or predates the
    derived columns (``event``, ``is_irrelevant``), so an old database from a
    previous version upgrades itself instead of breaking the API.
    """
    target = Path(path or db_path())
    if not force_rebuild and target.exists():
        try:
            with sqlite3.connect(target) as conn:
                df = pd.read_sql(f"SELECT * FROM {TABLE_NAME}", conn)
                try:
                    meta = pd.read_sql("SELECT key, value FROM etl_meta", conn)
                    attrs = dict(zip(meta["key"], meta["value"]))
                except Exception:  # noqa: BLE001 - legacy db without meta table
                    attrs = {}
            required = {"event", "event_method", "is_irrelevant", "message_length"}
            if required.issubset(df.columns):
                df.attrs["raw_rows"] = int(attrs.get("raw_rows", len(df)))
                df.attrs["duplicates_removed"] = int(attrs.get("duplicates_removed", 0))
                logger.info("ETL: loaded %s rows from SQLite cache", f"{len(df):,}")
                return df
            logger.warning("ETL: cache is missing derived columns, rebuilding")
        except Exception as exc:  # noqa: BLE001 - corrupt cache should self-heal
            logger.warning("ETL: cache unreadable (%s), rebuilding", exc)

    df = build_clean_data()
    save_to_sqlite(df, target)
    return df


def category_columns(df: pd.DataFrame) -> list[str]:
    """Canonical category columns present in a frame, in dataset order."""
    return [c for c in CATEGORY_NAMES if c in df.columns]


def need_columns(df: pd.DataFrame) -> list[str]:
    """Category columns that describe an actual need (drops meta labels)."""
    return [c for c in category_columns(df) if c not in META_CATEGORIES]


def relevant(df: pd.DataFrame) -> pd.DataFrame:
    """Rows excluding ``related == 2`` noise."""
    if "is_irrelevant" not in df.columns:
        return df
    return df[df["is_irrelevant"] == 0]


def main() -> None:  # pragma: no cover - CLI entry point
    logging.basicConfig(level="INFO", format="%(levelname)s %(name)s: %(message)s")
    df = load_clean_data(force_rebuild=True)
    print(df[["id", "message", "genre", "event", "event_method"]].head(5).to_string())
    print("\nEvent distribution:")
    print(df["event"].value_counts().to_string())
    print("\nEvent method:")
    print(df["event_method"].value_counts().to_string())
    print(f"\nIrrelevant (related=2): {int(df['is_irrelevant'].sum())}")


if __name__ == "__main__":  # pragma: no cover
    main()
