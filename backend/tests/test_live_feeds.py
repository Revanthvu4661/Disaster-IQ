"""Live feed parsing, merging and graceful degradation, without the network.

Every test drives ``live_feeds`` through an ``httpx.MockTransport`` that serves
small payloads shaped like the real USGS, GDACS and EONET responses.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import live_feeds

NOW = datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


QUAKE_TIME = NOW - timedelta(hours=5)

USGS = {
    "features": [
        {
            "id": "us1",
            "properties": {
                "mag": 6.4, "place": "49 km NNE of Kainantu, Papua New Guinea",
                "time": QUAKE_TIME.timestamp() * 1000, "updated": QUAKE_TIME.timestamp() * 1000,
                "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us1",
                "title": "M 6.4 - 49 km NNE of Kainantu, Papua New Guinea", "alert": "yellow",
            },
            "geometry": {"coordinates": [146.0, -5.9, 10]},
        },
        {
            "id": "us2",
            "properties": {
                "mag": 4.7, "place": "Scotia Sea", "time": (NOW - timedelta(days=2)).timestamp() * 1000,
                "url": "u2", "title": "M 4.7 - Scotia Sea", "alert": None,
            },
            "geometry": {"coordinates": [-40.0, -60.0, 10]},
        },
    ]
}


def _gdacs_feature(code, eventid, name, lon, lat, **props):
    base = {
        "eventtype": code, "eventid": eventid, "name": name, "eventname": props.pop("eventname", ""),
        "alertlevel": props.pop("alertlevel", "Green"), "iscurrent": props.pop("iscurrent", "true"),
        "fromdate": props.pop("fromdate", _iso(NOW - timedelta(days=1))),
        "todate": props.pop("todate", _iso(NOW)), "country": props.pop("country", ""),
        "severitydata": props.pop("severitydata", {}),
        "url": {"report": f"https://www.gdacs.org/report.aspx?eventid={eventid}"},
    }
    return {"properties": base, "geometry": {"type": "Point", "coordinates": [lon, lat]}}


GDACS = {
    "EQ": {"features": [
        # Same quake as us1, 40 s later and ~11 km away, with a different magnitude.
        _gdacs_feature("EQ", 1, "Earthquake in PNG", 146.1, -5.9,
                       fromdate=_iso(QUAKE_TIME + timedelta(seconds=40)),
                       severitydata={"severity": 6.1}, alertlevel="Orange"),
        # Too old to be current.
        _gdacs_feature("EQ", 2, "Old quake", 10, 10, fromdate=_iso(NOW - timedelta(days=12))),
    ]},
    "TC": {"features": [
        _gdacs_feature("TC", 10, "Tropical Cyclone POLO-26", -101.8, 15.4, eventname="POLO-26",
                       severitydata={"severity": 287.0, "severityunit": "km/h"}),
        _gdacs_feature("TC", 11, "Tropical Cyclone OLD-26", 0, 0, eventname="OLD-26", iscurrent="false"),
    ]},
    "FL": {"features": [_gdacs_feature("FL", 20, "Flood in  Italy", 15.0, 37.5, country="Italy")]},
}

EONET = {"events": [
    {
        "id": "EONET_1", "title": "Hurricane Polo", "closed": None,
        "categories": [{"id": "severeStorms"}], "sources": [{"id": "NOAA_NHC", "url": "nhc"}],
        "geometry": [
            {"date": _iso(NOW - timedelta(days=2)) + "Z", "type": "Point", "coordinates": [-100, 15]},
            {"date": _iso(NOW - timedelta(hours=3)) + "Z", "type": "Point",
             "coordinates": [-101.5, 15.2], "magnitudeValue": 130, "magnitudeUnit": "kts"},
        ],
    },
    {
        # A GDACS flood republished by EONET, with a lat-first polygon.
        "id": "EONET_2", "title": "Flood in Italy 20", "closed": _iso(NOW + timedelta(days=3)) + "Z",
        "categories": [{"id": "floods"}],
        "sources": [{"id": "GDACS", "url": "https://www.gdacs.org/report.aspx?eventtype=FL&eventid=20"}],
        "geometry": [{"date": _iso(NOW) + "Z", "type": "Polygon", "coordinates": [[[37.5, 15.0]]]}],
    },
    {
        "id": "EONET_3", "title": "Closed storm", "closed": _iso(NOW - timedelta(days=1)) + "Z",
        "categories": [{"id": "severeStorms"}], "sources": [],
        "geometry": [{"date": _iso(NOW) + "Z", "type": "Point", "coordinates": [0, 0]}],
    },
]}

def _handler(fail: set[str] | frozenset[str] = frozenset()):
    def handle(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        host = request.url.host
        if any(name in host for name in fail):
            return httpx.Response(503)
        if "summary/4.5_week" in url:
            return httpx.Response(200, json=USGS)
        if "gdacs" in host:
            return httpx.Response(200, json=GDACS[request.url.params["eventlist"]])
        if "eonet" in host:
            if request.url.params.get("limit") == "1":
                return httpx.Response(200, json={"events": []})
            return httpx.Response(200, json=EONET)
        return httpx.Response(404)

    return handle


@pytest.fixture
def mock_feeds(monkeypatch):
    """Route live_feeds' httpx.Client through a mock transport; returns a setter."""
    state = {"fail": frozenset()}
    real_client = httpx.Client

    def client_factory(*args, **kwargs):
        kwargs.pop("follow_redirects", None)
        return real_client(transport=httpx.MockTransport(_handler(state["fail"])), **kwargs)

    monkeypatch.setattr(live_feeds.httpx, "Client", client_factory)
    live_feeds.clear_cache()
    yield state
    live_feeds.clear_cache()


def test_parsers_apply_current_rules(mock_feeds) -> None:
    payload = live_feeds.get_live(force=True)
    titles = {e["title"] for e in payload["events"]}
    assert "Old quake" not in titles
    assert "Tropical Cyclone OLD-26" not in titles
    assert "Closed storm" not in titles
    assert "Flood in Italy" in titles  # double space collapsed


def test_earthquakes_merge_and_keep_both_readings(mock_feeds) -> None:
    events = live_feeds.get_live(force=True)["events"]
    png = next(e for e in events if e["type"] == "earthquake" and "Kainantu" in e["title"])
    assert [s["source"] for s in png["sources"]] == ["usgs", "gdacs"]
    assert png["magnitude"] == 6.4  # USGS leads earthquakes
    assert png["disagreement"] == "USGS M6.4 vs GDACS M6.1"
    assert png["alert"] == "orange"  # highest alert across sources
    scotia = next(e for e in events if "Scotia" in e["title"])
    assert len(scotia["sources"]) == 1


def test_cyclones_merge_by_storm_name(mock_feeds) -> None:
    events = live_feeds.get_live(force=True)["events"]
    polo = [e for e in events if e["type"] == "cyclone"]
    assert len(polo) == 1
    assert {s["source"] for s in polo[0]["sources"]} == {"gdacs", "eonet"}
    assert "287 km/h" in polo[0]["severity"]["label"] and "130 kts" in polo[0]["severity"]["label"]


def test_eonet_flood_joins_its_gdacs_record(mock_feeds) -> None:
    events = live_feeds.get_live(force=True)["events"]
    floods = [e for e in events if e["type"] == "flood"]
    assert len(floods) == 1
    eonet = next(s for s in floods[0]["sources"] if s["source"] == "eonet")
    assert eonet["upstream"] == "GDACS"
    assert floods[0]["latitude"] == 37.5 and floods[0]["longitude"] == 15.0  # GDACS point


def test_one_feed_down_marks_only_its_layers(mock_feeds) -> None:
    mock_feeds["fail"] = frozenset({"gdacs"})
    payload = live_feeds.get_live(force=True)
    status = {s["id"]: s["status"] for s in payload["sources"]}
    assert status["gdacs"] == "unavailable" and status["usgs"] == "ok"
    assert payload["layers"]["earthquake"]["status"] == "partial"
    assert payload["layers"]["flood"]["status"] == "partial"  # EONET still answers
    assert payload["layers"]["earthquake"]["count"] == 2  # USGS still answers


def test_failed_refresh_serves_stale_copy(mock_feeds) -> None:
    live_feeds.get_live(force=True)
    mock_feeds["fail"] = frozenset({"eonet"})
    payload = live_feeds.get_live(force=True)
    eonet = next(s for s in payload["sources"] if s["id"] == "eonet")
    assert eonet["status"] == "stale" and eonet["count"] > 0


def test_every_feed_down_is_unavailable_not_empty(mock_feeds) -> None:
    mock_feeds["fail"] = frozenset({"usgs", "gdacs", "eonet"})
    payload = live_feeds.get_live(force=True)
    assert payload["events"] == []
    assert {layer["status"] for layer in payload["layers"].values()} == {"unavailable"}


def test_storm_key_normalisation() -> None:
    assert live_feeds.storm_key("Hurricane Polo") == "polo"
    assert live_feeds.storm_key("POLO-26") == "polo"
    assert live_feeds.storm_key("Tropical Cyclone 01B") == "01b"


def test_live_endpoints(mock_feeds, client: TestClient) -> None:
    body = client.get("/api/live/events?type=cyclone&refresh=true").json()
    assert {e["type"] for e in body["events"]} == {"cyclone"}
    assert list(body["layers"]) == ["cyclone"]
    summary = client.get("/api/live/summary").json()
    assert list(summary["layers"]) == ["earthquake", "flood", "cyclone"]
    assert client.get("/api/live/events?type=tsunami").status_code == 404


def test_expired_cache_is_served_while_refreshing(mock_feeds) -> None:
    first = live_feeds.get_live(force=True)
    for entry in live_feeds._cache.values():
        entry["at"] = 0  # everything expired
    mock_feeds["fail"] = frozenset({"usgs"})
    second = live_feeds.get_live()  # must not block on the refresh
    assert len(second["events"]) == len(first["events"])
    # Wait for the background refresh, then USGS is stale (last good copy kept).
    for _ in range(100):
        if live_feeds._lock.acquire(timeout=0.05):
            live_feeds._lock.release()
            if live_feeds._cache["usgs"]["status"] != "ok":
                break
    assert live_feeds._cache["usgs"]["status"] == "stale"
    assert live_feeds._cache["usgs"]["events"]
