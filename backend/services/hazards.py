"""Live hazard feeds (USGS, NASA EONET, GDACS), cached and fault-tolerant.

The feeds are free and key-less. They are fetched server-side so the browser is
not exposed to CORS limits or feed outages, cached for ten minutes, and always
returned with a per-source status so the UI can show a partial or offline
state instead of failing.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from backend.config import get_settings

logger = logging.getLogger(__name__)

USGS_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson"
EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100"
GDACS_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?fromDate=&toDate=&alertlevel=Orange;Red"

# India bounding box, used by the "India focus" filter in the UI.
INDIA_BBOX = {"min_lat": 6.0, "max_lat": 37.5, "min_lon": 68.0, "max_lon": 97.5}

_cache: dict[str, Any] = {"at": 0.0, "payload": None}


def _in_india(lat: float | None, lon: float | None) -> bool:
    if lat is None or lon is None:
        return False
    return (
        INDIA_BBOX["min_lat"] <= lat <= INDIA_BBOX["max_lat"]
        and INDIA_BBOX["min_lon"] <= lon <= INDIA_BBOX["max_lon"]
    )


def _hazard(
    *, source: str, id_: str, title: str, category: str, lat: float | None,
    lon: float | None, time_iso: str | None, severity: str | None, url: str | None,
    magnitude: float | None = None,
) -> dict[str, Any]:
    return {
        "source": source,
        "id": f"{source}:{id_}",
        "title": title,
        "category": category,
        "latitude": lat,
        "longitude": lon,
        "time": time_iso,
        "severity": severity,
        "magnitude": magnitude,
        "url": url,
        "in_india": _in_india(lat, lon),
    }


def _iso(ms: float | None) -> str | None:
    if not ms:
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ms / 1000))


def _parse_usgs(data: dict) -> list[dict]:
    out = []
    for feature in data.get("features", []):
        props = feature.get("properties", {})
        coords = (feature.get("geometry") or {}).get("coordinates") or [None, None]
        mag = props.get("mag")
        out.append(
            _hazard(
                source="usgs",
                id_=str(feature.get("id")),
                title=props.get("title") or "Earthquake",
                category="Earthquake",
                lat=coords[1], lon=coords[0],
                time_iso=_iso(props.get("time")),
                severity=(
                    "critical" if (mag or 0) >= 6.5
                    else "high" if (mag or 0) >= 5.5
                    else "medium" if (mag or 0) >= 4.5
                    else "low"
                ),
                url=props.get("url"),
                magnitude=float(mag) if mag is not None else None,
            )
        )
    return out


def _parse_eonet(data: dict) -> list[dict]:
    out = []
    for event in data.get("events", []):
        geometries = event.get("geometry") or []
        if not geometries:
            continue
        last = geometries[-1]
        coords = last.get("coordinates") or []
        lat = lon = None
        if last.get("type") == "Point" and len(coords) >= 2:
            lon, lat = float(coords[0]), float(coords[1])
        categories = event.get("categories") or [{}]
        out.append(
            _hazard(
                source="eonet",
                id_=str(event.get("id")),
                title=event.get("title") or "Event",
                category=categories[0].get("title", "Event"),
                lat=lat, lon=lon,
                time_iso=last.get("date"),
                severity="medium",
                url=event.get("link"),
            )
        )
    return out


def _parse_gdacs(data: dict) -> list[dict]:
    out = []
    for feature in data.get("features", []):
        props = feature.get("properties", {})
        coords = (feature.get("geometry") or {}).get("coordinates") or [None, None]
        alert = str(props.get("alertlevel", "")).lower()
        out.append(
            _hazard(
                source="gdacs",
                id_=str(props.get("eventid")),
                title=props.get("htmldescription") or props.get("name") or "GDACS event",
                category=str(props.get("eventtype", "")).upper() or "Event",
                lat=coords[1], lon=coords[0],
                time_iso=props.get("fromdate"),
                severity="critical" if alert == "red" else "high" if alert == "orange" else "medium",
                url=props.get("url", {}).get("report") if isinstance(props.get("url"), dict) else None,
            )
        )
    return out


SOURCES = (
    ("usgs", USGS_URL, _parse_usgs, "USGS earthquakes (M2.5+, past day)"),
    ("eonet", EONET_URL, _parse_eonet, "NASA EONET open natural events"),
    ("gdacs", GDACS_URL, _parse_gdacs, "GDACS orange and red alerts"),
)


def fetch_hazards(force: bool = False) -> dict[str, Any]:
    """Fetch all feeds, honouring the TTL cache. Never raises."""
    settings = get_settings()
    now = time.time()
    cached = _cache.get("payload")
    if (
        not force
        and cached is not None
        and now - float(_cache["at"]) < settings.hazards_ttl_seconds
    ):
        return {**cached, "cached": True, "age_seconds": int(now - float(_cache["at"]))}

    if not settings.hazards_enabled:
        return {
            "hazards": [], "sources": [
                {"source": name, "status": "disabled", "count": 0, "description": desc}
                for name, _, _, desc in SOURCES
            ],
            "cached": False, "age_seconds": 0, "fetched_at": _iso(now * 1000),
            "online": False,
        }

    hazards: list[dict] = []
    statuses: list[dict] = []
    with httpx.Client(
        timeout=settings.hazards_timeout_seconds,
        headers={"User-Agent": "DisasterIQ/2.0 (analytics dashboard)"},
        follow_redirects=True,
    ) as client:
        for name, url, parser, description in SOURCES:
            try:
                response = client.get(url)
                response.raise_for_status()
                parsed = parser(response.json())
                hazards.extend(parsed)
                statuses.append(
                    {"source": name, "status": "ok", "count": len(parsed),
                     "description": description}
                )
            except Exception as exc:  # noqa: BLE001 - a dead feed must not break the page
                logger.warning("hazards: %s unavailable (%s)", name, exc)
                statuses.append(
                    {"source": name, "status": "unavailable", "count": 0,
                     "description": description, "error": type(exc).__name__}
                )

    hazards.sort(key=lambda h: h.get("time") or "", reverse=True)
    payload = {
        "hazards": hazards,
        "sources": statuses,
        "fetched_at": _iso(now * 1000),
        "online": any(s["status"] == "ok" for s in statuses),
        "india_count": sum(1 for h in hazards if h["in_india"]),
    }
    if payload["online"]:
        _cache["at"] = now
        _cache["payload"] = payload
    return {**payload, "cached": False, "age_seconds": 0}


def clear_cache() -> None:
    """Drop the cached payload (used by tests)."""
    _cache["at"] = 0.0
    _cache["payload"] = None
