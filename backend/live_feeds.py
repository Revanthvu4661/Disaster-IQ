"""Live disaster feeds for the three disaster types, merged, cached and fault-tolerant.

One function per source, each returning normalised events:

========================  ==================================================  =====================
source                    endpoint                                            types
========================  ==================================================  =====================
``usgs``                  USGS summary feed, M4.5+, past week                 earthquake
``gdacs``                 GDACS ``geteventlist/SEARCH`` EQ, TC, FL            earthquake, cyclone,
                                                                              flood
``eonet``                 NASA EONET v3, severeStorms/floods, not closed      cyclone, flood
========================  ==================================================  =====================

Every source is cached separately for ``LIVE_TTL_SECONDS`` (10 min). A failed
refresh keeps serving the last good copy marked ``stale``; a source that never
answered is ``unavailable``. Status is also rolled up per disaster *layer*, so
the UI can say "flood layer: GDACS unavailable, EONET ok" instead of showing an
empty map that reads as "nothing is happening".

:func:`merge` joins records of the same event from different sources. It never
averages or silently picks: each source's own reading stays in ``sources`` and
a disagreement (for example two magnitudes) is spelled out in ``disagreement``.

:func:`severity_level` puts each merged event in one of three classes with a
fixed, published rule (:data:`SEVERITY_RULE`); an event the rule does not cover
gets no class rather than a guess. Cyclone tracks are only drawn from what a
source publishes: GDACS observed and forecast track lines, or the position
history NASA EONET reports.

The last good response of every source is also written to
``LIVE_CACHE_DIR``, so a feed that is down on startup is still shown, marked
stale, with its age.
"""

from __future__ import annotations

import json
import logging
import math
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import httpx

from backend import disaster_types
from backend.config import get_settings

logger = logging.getLogger(__name__)

USGS_WEEK_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson"
USGS_FDSN_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"
GDACS_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events"

GDACS_TYPES = {"EQ": "earthquake", "TC": "cyclone", "FL": "flood"}
EONET_TYPES = {
    "severeStorms": "cyclone",
    "floods": "flood",
}

#: How each source decides that an event is *current*. Returned to the UI.
CURRENT_RULES = {
    "usgs": "Magnitude 4.5 or greater in the past 7 days.",
    "gdacs": (
        "Earthquakes of the past 7 days; cyclones and floods GDACS flags as current."
    ),
    "eonet": "Events of the past 30 days that EONET has not closed.",
}

SOURCE_NAMES = {
    "usgs": "USGS",
    "gdacs": "GDACS",
    "eonet": "NASA EONET",
}

#: Sources that serve each disaster layer.
LAYER_SOURCES = {
    "earthquake": ["usgs", "gdacs"],
    "flood": ["gdacs", "eonet"],
    "cyclone": ["gdacs", "eonet"],
}

ALERT_RANK = {"red": 4, "orange": 3, "yellow": 2, "green": 1}

#: The severity classes shown on the map, lowest first.
SEVERITY_LEVELS = ("moderate", "high", "very_high")
GDACS_SEVERITY = {"green": "moderate", "orange": "high", "red": "very_high"}

#: The rule behind :func:`severity_level`, returned to the UI for its tooltip.
SEVERITY_RULE = (
    "GDACS alert Green = Moderate, Orange = High, Red = Very High. "
    "USGS earthquakes without a GDACS alert: M4.5-5.9 Moderate, M6.0-6.9 High, "
    "M7.0+ Very High. Events neither rule covers are not rated."
)

KNOTS_TO_KMH = 1.852

_cache: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()


# ── helpers ───────────────────────────────────────────────────────────────────


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def _parse_dt(value: Any) -> datetime | None:
    """Parse epoch milliseconds or an ISO string (with or without zone) as UTC."""
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
    text = str(value).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(min(1.0, a)))


def _clean(text: Any) -> str | None:
    """Collapse the double spaces GDACS leaves in names ("Bosnia  and  Herzegovina")."""
    if text in (None, ""):
        return None
    return re.sub(r"\s+", " ", str(text)).strip(" ,") or None


def _float(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _event(
    *,
    source: str,
    source_id: str,
    type_: str,
    title: str,
    lat: float | None,
    lon: float | None,
    date: datetime | None,
    url: str | None,
    location: str | None = None,
    updated: datetime | None = None,
    alert: str | None = None,
    severity_label: str | None = None,
    severity_value: float | None = None,
    severity_unit: str | None = None,
    magnitude: float | None = None,
    kind: str = "observed",
    upstream: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    alert = alert.lower() if alert else None
    reading = {
        "source": source,
        "source_name": SOURCE_NAMES[source],
        "source_id": source_id,
        "url": url,
        "title": title,
        "date": _iso(date),
        "alert": alert,
        "severity_label": severity_label,
        "magnitude": magnitude,
        "latitude": lat,
        "longitude": lon,
        "upstream": upstream,
    }
    return {
        "id": f"{type_}:{source}:{source_id}",
        "type": type_,
        "title": title,
        "location": location,
        "latitude": lat,
        "longitude": lon,
        "date": _iso(date),
        "updated": _iso(updated),
        "alert": alert,
        "severity": {
            "label": severity_label,
            "value": severity_value,
            "unit": severity_unit,
            "rank": ALERT_RANK.get(alert or "", 0),
        },
        "magnitude": magnitude,
        "kind": kind,
        "url": url,
        "sources": [reading],
        "disagreement": None,
        **(extra or {}),
    }


# ── sources ───────────────────────────────────────────────────────────────────


def fetch_usgs(client: httpx.Client) -> tuple[list[dict], dict]:
    """USGS earthquakes, magnitude 4.5+, past week. PAGER alert when issued."""
    data = client.get(USGS_WEEK_URL).json()
    out = []
    for feature in data.get("features", []):
        props = feature.get("properties") or {}
        coords = (feature.get("geometry") or {}).get("coordinates") or [None, None, None]
        mag = _float(props.get("mag"))
        alert = props.get("alert")
        label = f"M{mag:.1f}" if mag is not None else "Magnitude n/a"
        if alert:
            label += f" · PAGER {alert}"
        out.append(
            _event(
                source="usgs",
                source_id=str(feature.get("id")),
                type_="earthquake",
                title=props.get("title") or "Earthquake",
                location=props.get("place"),
                lat=_float(coords[1]),
                lon=_float(coords[0]),
                date=_parse_dt(props.get("time")),
                updated=_parse_dt(props.get("updated")),
                url=props.get("url"),
                alert=alert,
                severity_label=label,
                severity_value=mag,
                severity_unit="magnitude",
                magnitude=mag,
                extra={"tsunami": bool(props.get("tsunami"))},
            )
        )
    return out, {}


def _gdacs_current(type_: str, props: dict, now: datetime) -> bool:
    start = _parse_dt(props.get("fromdate"))
    if type_ == "earthquake":
        return bool(start and start >= now - timedelta(days=7))
    return str(props.get("iscurrent", "")).lower() == "true"


def fetch_gdacs(client: httpx.Client) -> tuple[list[dict], dict]:
    """GDACS events per hazard code, filtered to what is current (see CURRENT_RULES)."""
    now = _now()
    out: list[dict] = []
    failures: list[str] = []
    track_urls: list[tuple[int, str]] = []
    for code, type_ in GDACS_TYPES.items():
        try:
            response = client.get(
                GDACS_URL, params={"eventlist": code, "alertlevel": "Green;Orange;Red"}
            )
            response.raise_for_status()
            # GDACS answers 204 with an empty body when there is nothing to list.
            data = response.json() if response.content else {"features": []}
        except Exception as exc:  # noqa: BLE001 - one hazard code failing is partial
            logger.warning("live: gdacs %s failed (%s)", code, exc)
            failures.append(code)
            continue
        for feature in data.get("features", []):
            props = feature.get("properties") or {}
            if not _gdacs_current(type_, props, now):
                continue
            coords = (feature.get("geometry") or {}).get("coordinates") or [None, None]
            sev = props.get("severitydata") or {}
            alert = str(props.get("alertlevel") or "").lower() or None
            magnitude = _float(sev.get("severity")) if type_ == "earthquake" else None
            parts = [f"{alert.title()} alert" if alert else None]
            if type_ == "earthquake" and magnitude is not None:
                parts.insert(0, f"M{magnitude:.1f}")
            elif type_ == "cyclone" and _float(sev.get("severity")):
                parts.append(f"max wind {float(sev['severity']):.0f} km/h")
            urls = props.get("url") if isinstance(props.get("url"), dict) else {}
            wind = (
                _float(sev.get("severity"))
                if type_ == "cyclone" and str(sev.get("severityunit") or "").lower() == "km/h"
                else None
            )
            if type_ == "cyclone" and urls.get("geometry"):
                track_urls.append((len(out), urls["geometry"]))
            out.append(
                _event(
                    source="gdacs",
                    source_id=f"{code}{props.get('eventid')}",
                    type_=type_,
                    title=_clean(props.get("name") or props.get("description")) or "GDACS event",
                    location=_clean(props.get("country")),
                    lat=_float(coords[1]) if len(coords) > 1 else None,
                    lon=_float(coords[0]) if coords else None,
                    date=_parse_dt(props.get("fromdate")),
                    updated=_parse_dt(props.get("datemodified") or props.get("todate")),
                    url=urls.get("report"),
                    alert=alert,
                    severity_label=" · ".join(p for p in parts if p) or None,
                    severity_value=_float(sev.get("severity")),
                    severity_unit=sev.get("severityunit") or None,
                    magnitude=magnitude,
                    extra={
                        "gdacs_event_id": str(props.get("eventid")),
                        "storm_name": _clean(props.get("eventname")) if code == "TC" else None,
                        "wind_kmh": round(wind) if wind else None,
                        "period_end": _iso(_parse_dt(props.get("todate"))),
                    },
                )
            )
    if len(failures) == len(GDACS_TYPES):
        raise RuntimeError("every GDACS hazard query failed")
    tracks = _gdacs_tracks(client, [url for _, url in track_urls])
    for index, url in track_urls:
        out[index]["track"] = tracks.get(url)
    return out, {"failed_codes": failures}


# GDACS publishes one track per cyclone *episode*; the geometry URL names the
# episode, so a cached track is reused until GDACS issues a new episode.
_track_cache: dict[str, dict | None] = {}

Point = tuple[float, float]


def _chain(segments: list[tuple[Point, Point]]) -> list[Point]:
    """Join two-point line segments that share end points into one path.

    GDACS lists track segments out of time order, so they are linked by their
    end points. Returns the longest connected path.
    """
    by_start = {start: end for start, end in segments}
    ends = {end for _, end in segments}
    best: list[Point] = []
    for head in [start for start in by_start if start not in ends]:
        path = [head]
        seen = {head}
        while path[-1] in by_start and by_start[path[-1]] not in seen:
            path.append(by_start[path[-1]])
            seen.add(path[-1])
        if len(path) > len(best):
            best = path
    return best


def _as_latlon(path: list[Point]) -> list[list[float]]:
    """(lon, lat) path -> [[lat, lon], ...] rounded, or [] when it is not a line."""
    return [[round(lat, 3), round(lon, 3)] for lon, lat in path] if len(path) >= 2 else []


def parse_gdacs_track(data: dict) -> dict | None:
    """Observed and forecast track lines from a GDACS ``getgeometry`` response."""
    groups: dict[bool, list] = {False: [], True: []}
    for feature in data.get("features") or []:
        props = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        if not str(props.get("Class", "")).startswith("Line_") or geometry.get("type") != "LineString":
            continue
        coords = [
            (_float(c[0]), _float(c[1])) for c in geometry.get("coordinates") or [] if len(c) >= 2
        ]
        coords = [c for c in coords if None not in c]
        forecast = str(props.get("forecast")).lower() == "true"
        groups[forecast].extend(zip(coords, coords[1:]))
    observed, forecast = _as_latlon(_chain(groups[False])), _as_latlon(_chain(groups[True]))
    if not observed and not forecast:
        return None
    return {"observed": observed, "forecast": forecast, "source": "GDACS"}


def _gdacs_tracks(client: httpx.Client, urls: list[str]) -> dict[str, dict | None]:
    """Track per geometry URL, fetched in parallel within one timeout.

    A track that cannot be fetched in time is simply absent: nothing is drawn.
    """
    missing = [url for url in urls if url not in _track_cache]

    def fetch(url: str) -> None:
        try:
            response = client.get(url)
            response.raise_for_status()
            _track_cache[url] = parse_gdacs_track(response.json()) if response.content else None
        except Exception as exc:  # noqa: BLE001 - a missing track only hides a line
            logger.info("live: gdacs track unavailable (%s)", exc)

    if missing:
        pool = ThreadPoolExecutor(max_workers=min(6, len(missing)))
        try:
            wait(
                [pool.submit(fetch, url) for url in missing],
                timeout=get_settings().live_timeout_seconds,
            )
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
    for old in set(_track_cache) - set(urls):
        _track_cache.pop(old, None)
    return {url: _track_cache.get(url) for url in urls}


_GDACS_ID_RE = re.compile(r"eventid=(\d+)")


def _eonet_point(geometry: dict) -> tuple[float | None, float | None]:
    """Point geometries only. EONET's GDACS-derived flood polygons put latitude
    first, against GeoJSON order, so their coordinates are not trusted here."""
    if geometry.get("type") == "Point":
        coords = geometry.get("coordinates") or []
        if len(coords) >= 2:
            return _float(coords[1]), _float(coords[0])
    return None, None


def fetch_eonet(client: httpx.Client) -> tuple[list[dict], dict]:
    """NASA EONET events of the past 30 days that are not closed yet."""
    now = _now()
    response = client.get(
        EONET_URL,
        params={"category": ",".join(EONET_TYPES), "days": 30, "status": "all"},
    )
    response.raise_for_status()
    out: list[dict] = []
    unlocatable = 0
    for event in response.json().get("events", []):
        closed = _parse_dt(event.get("closed"))
        if closed and closed < now:
            continue
        category = ((event.get("categories") or [{}])[0]).get("id")
        type_ = EONET_TYPES.get(category)
        if not type_:
            continue
        geometries = event.get("geometry") or []
        if not geometries:
            continue
        last = geometries[-1]
        lat, lon = _eonet_point(last)
        sources = event.get("sources") or []
        upstream_ids = [s.get("id") for s in sources if s.get("id")]
        gdacs_id = None
        for s in sources:
            match = _GDACS_ID_RE.search(s.get("url") or "")
            if s.get("id") == "GDACS" and match:
                gdacs_id = match.group(1)
        if lat is None and not gdacs_id:
            unlocatable += 1
            continue
        mag = _float(last.get("magnitudeValue"))
        unit = last.get("magnitudeUnit")
        label = f"{mag:.0f} {unit}" if mag is not None and unit else None
        wind = None
        if type_ == "cyclone" and mag is not None and str(unit).lower() == "kts":
            wind = round(mag * KNOTS_TO_KMH)
        points = [_eonet_point(g) for g in geometries]
        points = [[round(a, 3), round(b, 3)] for a, b in points if a is not None and b is not None]
        track = (
            {"observed": points, "forecast": [], "source": "NASA EONET"}
            if type_ == "cyclone" and len(points) >= 2 else None
        )
        if label and upstream_ids:
            label += f" ({', '.join(upstream_ids)})"
        out.append(
            _event(
                source="eonet",
                source_id=str(event.get("id")),
                type_=type_,
                title=event.get("title") or "EONET event",
                lat=lat,
                lon=lon,
                date=_parse_dt(geometries[0].get("date")),
                updated=_parse_dt(last.get("date")),
                url=(sources[0].get("url") if sources else None) or event.get("link"),
                severity_label=label,
                severity_value=mag,
                severity_unit=unit,
                upstream=", ".join(upstream_ids) or None,
                extra={"gdacs_event_id": gdacs_id, "wind_kmh": wind, "track": track},
            )
        )
    meta: dict[str, Any] = {"unlocatable_skipped": unlocatable}
    return out, meta


SOURCES: dict[str, Callable[[httpx.Client], tuple[list[dict], dict]]] = {
    "usgs": fetch_usgs,
    "gdacs": fetch_gdacs,
    "eonet": fetch_eonet,
}


# ── merge ─────────────────────────────────────────────────────────────────────

_NAME_TOKEN = re.compile(r"[a-z0-9]+")
_STORM_WORDS = {
    "tropical", "storm", "cyclone", "hurricane", "typhoon", "depression",
    "super", "severe", "post", "extratropical", "subtropical",
}


def storm_key(text: str | None) -> str | None:
    """'Hurricane Polo' -> 'polo'; 'POLO-26' -> 'polo'; 'Tropical Cyclone 01B' -> '01b'."""
    if not text:
        return None
    words = [w for w in _NAME_TOKEN.findall(text.lower()) if w not in _STORM_WORDS]
    words = [w for w in words if not re.fullmatch(r"\d{2}", w)]  # GDACS year suffix
    return words[0] if words else None


def _same_event(a: dict, b: dict) -> bool:
    if a["type"] != b["type"]:
        return False
    if a.get("gdacs_event_id") and a.get("gdacs_event_id") == b.get("gdacs_event_id"):
        return True
    have_coords = None not in (a["latitude"], a["longitude"], b["latitude"], b["longitude"])
    distance = (
        haversine_km(a["latitude"], a["longitude"], b["latitude"], b["longitude"])
        if have_coords else math.inf
    )
    ta, tb = _parse_dt(a["date"]), _parse_dt(b["date"])
    if a["type"] == "earthquake":
        return bool(ta and tb and abs((ta - tb).total_seconds()) <= 180 and distance <= 150)
    if a["type"] == "cyclone":
        ka = storm_key(a.get("storm_name") or a["title"])
        kb = storm_key(b.get("storm_name") or b["title"])
        if ka and kb and ka == kb:
            return True
        ua, ub = _parse_dt(a["updated"]) or ta, _parse_dt(b["updated"]) or tb
        return bool(distance <= 400 and ua and ub and abs((ua - ub).total_seconds()) <= 2 * 86400)
    if a["type"] == "flood":
        return distance <= 100
    return False


def _describe_disagreement(event: dict) -> str | None:
    mags = [
        (r["source_name"], r["magnitude"]) for r in event["sources"] if r["magnitude"] is not None
    ]
    if len(mags) >= 2 and max(m for _, m in mags) - min(m for _, m in mags) >= 0.2:
        return " vs ".join(f"{name} M{m:.1f}" for name, m in mags)
    return None


def merge(events: list[dict]) -> list[dict]:
    """Join records of one real event from several sources.

    Records are grouped greedily with :func:`_same_event`. The merged event keeps
    the first record's fields (sources are processed in priority order: USGS
    before GDACS for earthquakes, GDACS before EONET otherwise), fills gaps from
    the others, takes the highest alert, and lists every source's own reading.
    """
    merged: list[dict] = []
    for event in events:
        target = next((m for m in merged if _same_event(m, event)), None)
        if target is None:
            merged.append({**event, "sources": list(event["sources"])})
            continue
        target["sources"].extend(event["sources"])
        for key in (
            "latitude", "longitude", "location", "url", "magnitude", "updated",
            "storm_name", "wind_kmh", "track",
        ):
            if target.get(key) is None and event.get(key) is not None:
                target[key] = event[key]
        if event["severity"]["rank"] > target["severity"]["rank"]:
            target["alert"] = event["alert"]
            target["severity"] = {**target["severity"], "rank": event["severity"]["rank"]}
        labels = [r["severity_label"] for r in target["sources"] if r["severity_label"]]
        target["severity"] = {**target["severity"], "label": " | ".join(dict.fromkeys(labels))}
        target["disagreement"] = _describe_disagreement(target)
        target["id"] = f"{target['type']}:" + "+".join(
            f"{r['source']}:{r['source_id']}" for r in target["sources"]
        )
    return merged


# Order that decides which record leads a merged event.
MERGE_PRIORITY = {"usgs": 0, "gdacs": 1, "eonet": 2}


# ── severity ──────────────────────────────────────────────────────────────────


def _gdacs_alert(event: dict) -> str | None:
    """The highest GDACS alert among the event's own GDACS readings."""
    alerts = [
        r["alert"] for r in event["sources"]
        if r["source"] == "gdacs" and r.get("alert") in GDACS_SEVERITY
    ]
    return max(alerts, key=ALERT_RANK.get) if alerts else None


def severity_level(event: dict) -> tuple[str | None, str | None]:
    """The event's severity class and what it was based on (see SEVERITY_RULE).

    1. A GDACS alert decides: Green = moderate, Orange = high, Red = very_high.
    2. Otherwise a USGS earthquake reading decides by magnitude, rounded to the
       one decimal the UI shows: 4.5-5.9 moderate, 6.0-6.9 high, 7.0+ very_high.
    3. Anything else (an EONET-only storm, a quake below M4.5) is not rated.

    Only the GDACS reading counts in step 1: a merged event's ``alert`` can be a
    USGS PAGER colour, which measures something else.
    """
    alert = _gdacs_alert(event)
    if alert:
        return GDACS_SEVERITY[alert], f"GDACS {alert.title()} alert"
    if event["type"] == "earthquake":
        mags = [
            r["magnitude"] for r in event["sources"]
            if r["source"] == "usgs" and r["magnitude"] is not None
        ]
        if mags:
            mag = round(mags[0], 1)
            basis = f"USGS M{mag:.1f}, no GDACS alert"
            if mag >= 7.0:
                return "very_high", basis
            if mag >= 6.0:
                return "high", basis
            if mag >= 4.5:
                return "moderate", basis
    return None, None


def finalise(event: dict) -> dict:
    """Add the display fields the map reads. Missing values stay ``None``."""
    level, basis = severity_level(event)
    when = event["date"] if event["type"] == "earthquake" else (event["updated"] or event["date"])
    return {
        **event,
        "place": event.get("location") or event["title"],
        "time": when,
        "storm_name": event.get("storm_name") or None,
        "wind_kmh": event.get("wind_kmh"),
        "track": event.get("track"),
        "gdacs_alert": _gdacs_alert(event),
        "severity_level": level,
        "severity_basis": basis,
    }


# ── cache + orchestration ─────────────────────────────────────────────────────


def _disk_dir():
    return get_settings().live_cache_dir


def _save_disk(name: str, entry: dict) -> None:
    """Keep the last good response on disk; failure to write is not an error."""
    try:
        folder = _disk_dir()
        folder.mkdir(parents=True, exist_ok=True)
        tmp = folder / f"{name}.json.tmp"
        tmp.write_text(
            json.dumps({"at": entry["at"], "events": entry["events"], "meta": entry["meta"]}),
            encoding="utf-8",
        )
        tmp.replace(folder / f"{name}.json")
    except Exception as exc:  # noqa: BLE001
        logger.info("live: could not save %s cache (%s)", name, exc)


#: A saved copy older than this is not served: its "current" events have mostly ended.
DISK_MAX_AGE_SECONDS = 2 * 86400


def _load_disk(name: str) -> dict | None:
    """The last good response saved by an earlier run, or ``None`` (missing or too old)."""
    try:
        data = json.loads((_disk_dir() / f"{name}.json").read_text(encoding="utf-8"))
        if time.time() - float(data["at"]) > DISK_MAX_AGE_SECONDS:
            return None
        return {
            "at": float(data["at"]), "events": list(data["events"]),
            "meta": data.get("meta") or {}, "status": "stale", "error": None,
        }
    except Exception:  # noqa: BLE001 - missing or unreadable: nothing cached
        return None


def _mark_failed(name: str, error: str, started: float) -> None:
    """Serve the last good copy (memory, then disk) as stale, else mark unavailable."""
    previous = _cache.get(name)
    if not (previous and previous.get("events") is not None and previous["status"] != "unavailable"):
        previous = _load_disk(name)
    if previous:
        previous.update(status="stale", error=error, tried_at=started)
        _cache[name] = previous
    else:
        _cache[name] = {
            "at": started, "events": [], "meta": {}, "status": "unavailable",
            "error": error, "tried_at": started,
        }


def _refresh_source(name: str, client: httpx.Client) -> None:
    started = time.time()
    try:
        events, meta = SOURCES[name](client)
        entry = {
            "at": started, "events": events, "meta": meta, "status": "ok", "error": None,
            "tried_at": started,
        }
        _cache[name] = entry
        _save_disk(name, entry)
    except Exception as exc:  # noqa: BLE001 - third-party feeds fail; never raise
        logger.warning("live: %s unavailable (%s: %s)", name, type(exc).__name__, exc)
        _mark_failed(name, type(exc).__name__, started)


def _due(force: bool) -> list[str]:
    ttl = get_settings().live_ttl_seconds
    now = time.time()

    def needs_refresh(name: str) -> bool:
        entry = _cache.get(name)
        if force or entry is None:
            return True
        if entry["status"] != "ok":
            # Retry a failed feed after a minute, not on every request. `at` is the
            # time of the last good copy, so the last attempt is timed separately.
            return now - entry.get("tried_at", entry["at"]) > 60
        return now - entry["at"] > ttl

    return [name for name in SOURCES if needs_refresh(name)]


def _refresh(due: list[str]) -> None:
    """Fetch the due sources in parallel under one overall deadline.

    httpx's timeout applies per socket read, so a server that trickles its body
    (NASA EONET does) never trips it. A source still running at the deadline is
    marked unavailable (or stale, if it has an earlier good copy); closing the
    client then aborts its socket.
    """
    settings = get_settings()
    # GDACS runs four queries in sequence (~7 s each), so allow several timeouts.
    deadline = settings.live_timeout_seconds * 4
    client = httpx.Client(
        timeout=settings.live_timeout_seconds,
        headers={"User-Agent": "DisasterIQ/4.0 (disaster analytics dashboard)"},
        follow_redirects=True,
    )
    pool = ThreadPoolExecutor(max_workers=len(due))
    try:
        futures = {pool.submit(_refresh_source, name, client): name for name in due}
        _, late = wait(futures, timeout=deadline)
        for future in late:
            name = futures[future]
            logger.warning("live: %s exceeded the %.0fs deadline", name, deadline)
            _mark_failed(name, "Timeout", time.time())
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
        client.close()


def _refresh_in_background() -> None:
    if not _lock.acquire(blocking=False):
        return  # a refresh is already running
    try:
        due = _due(force=False)
        if due:
            _refresh(due)
    finally:
        _lock.release()


def _ensure_fresh(force: bool) -> None:
    """Stale-while-revalidate.

    A source that has never answered (or an explicit ``refresh``) is fetched
    before responding. Otherwise an expired cache is served immediately and
    refreshed on a background thread, so no page waits on a slow feed.
    """
    due = _due(force)
    if not due:
        return
    if force or any(name not in _cache for name in due):
        with _lock:
            due = _due(force)  # another request may have refreshed while we waited
            if due:
                _refresh(due)
        return
    threading.Thread(target=_refresh_in_background, daemon=True, name="live-refresh").start()


def _source_status(name: str) -> dict[str, Any]:
    entry = _cache.get(name) or {"status": "unavailable", "events": [], "at": 0, "meta": {}}
    return {
        "id": name,
        "name": SOURCE_NAMES[name],
        "status": entry["status"],
        "count": len(entry.get("events") or []),
        "fetched_at": _iso(datetime.fromtimestamp(entry["at"], tz=timezone.utc))
        if entry.get("at") else None,
        "age_seconds": int(time.time() - entry["at"]) if entry.get("at") else None,
        "error": entry.get("error"),
        "current_rule": CURRENT_RULES[name],
        "meta": entry.get("meta") or {},
    }


def get_live(force: bool = False) -> dict[str, Any]:
    """Merged live events for all five types, with source and layer status. Never raises."""
    settings = get_settings()
    if not settings.hazards_enabled:
        return {
            "events": [], "sources": [
                {**_source_status(n), "status": "disabled"} for n in SOURCES
            ],
            "layers": {
                t: {"status": "disabled", "count": 0, "sources": LAYER_SOURCES[t]}
                for t in disaster_types.IDS
            },
            "fetched_at": _iso(_now()),
        }

    _ensure_fresh(force)
    raw: list[dict] = []
    for name in sorted(SOURCES, key=MERGE_PRIORITY.get):
        raw.extend(_cache.get(name, {}).get("events") or [])
    merged = [finalise(e) for e in merge(raw)]
    # Records whose only source gave no usable coordinates (EONET floods tied to a
    # GDACS event that is no longer current) cannot be placed; count, don't hide.
    events = [e for e in merged if e["latitude"] is not None and e["longitude"] is not None]
    unlocated = [e for e in merged if e not in events]
    events.sort(key=lambda e: e["updated"] or e["date"] or "", reverse=True)

    sources = [_source_status(n) for n in SOURCES]
    by_name = {s["id"]: s for s in sources}
    layers: dict[str, Any] = {}
    for type_ in disaster_types.IDS:
        statuses = [by_name[n]["status"] for n in LAYER_SOURCES[type_]]
        ok = [s for s in statuses if s in {"ok", "stale"}]
        layers[type_] = {
            "status": "ok" if len(ok) == len(statuses) else "partial" if ok else "unavailable",
            "count": sum(1 for e in events if e["type"] == type_),
            "unlocated": sum(1 for e in unlocated if e["type"] == type_),
            "sources": [
                {"id": n, "name": SOURCE_NAMES[n], "status": by_name[n]["status"]}
                for n in LAYER_SOURCES[type_]
            ],
        }
    return {
        "events": events, "sources": sources, "layers": layers, "fetched_at": _iso(_now()),
        "severity_rule": SEVERITY_RULE,
    }


def clear_cache() -> None:
    """Drop every cached source and track (used by tests)."""
    _cache.clear()
    _track_cache.clear()
