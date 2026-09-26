"""DisasterIQ FastAPI application.

Run:
    uvicorn backend.main:app --reload --port 8000

Startup loads the historical store (building it from ``backend/data/clean/``
if needed), precomputes every analytics payload and fits the flood risk model
from ``backend/data/clean/flood/`` and the earthquake and cyclone hazard index from
``backend/data/clean/hazard/``. Failures are recorded
rather than fatal, so ``/health`` can report what is degraded.
"""

from __future__ import annotations

import logging
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.datastructures import MutableHeaders
from fastapi.responses import JSONResponse

from backend import live_feeds, schemas
from backend.data_pipeline import use_system_trust_store
from backend.config import get_settings
from backend.routers import disasters, flood_risk, hazard_risk, history, live, pre_prediction, recommendations
from backend.state import state

VERSION = "5.0.0"

logging.basicConfig(
    level=get_settings().log_level,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("disasteriq")

# The live feeds and the data pipeline verify TLS against the OS store, so they
# work behind TLS-inspecting proxies (no-op without the truststore package).
use_system_trust_store()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Warm every cache before the first request."""
    settings = get_settings()
    started = time.perf_counter()
    if settings.warm_cache:
        state.warm()
        # Prefetch the live feeds in the background so the first map visit is
        # served from cache; a slow or dead feed never delays startup.
        if settings.hazards_enabled and settings.live_prefetch:
            threading.Thread(target=live_feeds.get_live, daemon=True, name="live-prefetch").start()
        logger.info("startup complete in %.1fs", time.perf_counter() - started)
        if state.errors:
            logger.warning("degraded components: %s", ", ".join(state.errors))
    yield
    state.reset()


app = FastAPI(
    title="DisasterIQ API",
    version=VERSION,
    description=(
        "Historical impact of earthquakes, floods and cyclones "
        "(OWID/EM-DAT, USGS, NOAA IBTrACS), live events from USGS, GDACS and "
        "NASA EONET, risk prediction for earthquakes, floods and cyclones, and "
        "preparedness and response recommendations built on it."
    ),
    lifespan=lifespan,
)

_settings = get_settings()
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins,
    allow_credentials=_settings.cors_allow_credentials,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


class AccessLogMiddleware:
    """Structured access log with a duration, used for basic observability.

    A plain ASGI middleware, not ``@app.middleware("http")``: that decorator wraps every body in a stream, which
    stalled large responses (a few hundred KB) behind the Vite dev proxy.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status = 0

        async def send_with_timing(message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                duration_ms = (time.perf_counter() - started) * 1000
                MutableHeaders(scope=message)["X-Response-Time-ms"] = f"{duration_ms:.1f}"
            await send(message)

        try:
            await self.app(scope, receive, send_with_timing)
        finally:
            logger.info("%s %s -> %s in %.1fms", scope["method"], scope["path"], status,
                        (time.perf_counter() - started) * 1000)


app.add_middleware(AccessLogMiddleware)


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
    """Turn validation errors raised inside services into a readable 400."""
    logger.warning("value error on %s: %s", request.url.path, exc)
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/", tags=["health"], response_model=schemas.HealthResponse)
def root() -> dict:
    """Service banner and readiness."""
    return state.health(VERSION)


@app.get("/health", tags=["health"], response_model=schemas.HealthResponse)
def health() -> dict:
    """Readiness probe: reports whether the historical analytics are loaded."""
    return state.health(VERSION)


app.include_router(disasters.router)
app.include_router(history.router)
app.include_router(live.router)
app.include_router(flood_risk.router)
app.include_router(hazard_risk.router)
app.include_router(recommendations.router)
app.include_router(pre_prediction.router)
