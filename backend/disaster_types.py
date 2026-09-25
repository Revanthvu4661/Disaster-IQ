"""The three disaster types DisasterIQ reports on: earthquake, flood, cyclone, and how each maps to data.

This is the backend half of the taxonomy: which OWID/EM-DAT column suffix and
event-count entity a type reads, which point-level source (if any) gives it
real coordinates and dates, and the feed codes used to pull live events.
Presentation (label, icon, colour) lives in
``frontend/src/config/disasterTypes.js``; ``tests/test_disasters.py`` asserts
both files list the same ids in the same order.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DisasterType:
    id: str
    label: str
    #: Column suffix in OWID's EM-DAT table (``deaths_<owid_key>``).
    owid_key: str
    #: Entity name in OWID's "number of natural disaster events" chart.
    owid_events_entity: str
    #: Point-level historical source: "usgs", "ibtracs" or ``None`` (country level only).
    point_source: str | None
    #: Shown wherever EM-DAT's category differs from the page label.
    caveat: str | None = None
    gdacs_codes: tuple[str, ...] = ()
    eonet_categories: tuple[str, ...] = ()
    usgs_products: tuple[str, ...] = ()


DISASTER_TYPES: tuple[DisasterType, ...] = (
    DisasterType(
        id="earthquake",
        label="Earthquake",
        owid_key="earthquake",
        owid_events_entity="Earthquake",
        point_source="usgs",
        gdacs_codes=("EQ",),
        usgs_products=("earthquake",),
    ),
    DisasterType(
        id="flood",
        label="Flood",
        owid_key="flood",
        owid_events_entity="Flood",
        point_source=None,
        gdacs_codes=("FL",),
        eonet_categories=("floods",),
    ),
    DisasterType(
        id="cyclone",
        label="Cyclone/Hurricane",
        owid_key="storm",
        owid_events_entity="Extreme weather",
        point_source="ibtracs",
        caveat=(
            "Impact figures use EM-DAT's \"Storm\" category, the only storm split "
            "in the free OWID export. Besides tropical cyclones it includes "
            "tornadoes, convective and extra-tropical storms. The point layer "
            "(NOAA IBTrACS) is tropical cyclones only."
        ),
        gdacs_codes=("TC",),
        eonet_categories=("severeStorms",),
    ),
)

BY_ID: dict[str, DisasterType] = {d.id: d for d in DISASTER_TYPES}
IDS: list[str] = [d.id for d in DISASTER_TYPES]


def get(disaster_id: str) -> DisasterType:
    """Look up a type by id; raises ``KeyError`` for unknown ids."""
    return BY_ID[disaster_id]


def as_dict(d: DisasterType) -> dict:
    """JSON-friendly description used by ``/api/disasters/types``."""
    return {
        "id": d.id,
        "label": d.label,
        "owid_key": d.owid_key,
        "owid_events_entity": d.owid_events_entity,
        "point_source": d.point_source,
        "caveat": d.caveat,
        "gdacs_codes": list(d.gdacs_codes),
        "eonet_categories": list(d.eonet_categories),
        "usgs_products": list(d.usgs_products),
    }
