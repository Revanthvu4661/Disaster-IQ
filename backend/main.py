"""DisasterIQ FastAPI application.

Run:
    uvicorn backend.main:app --reload --port 8000

Startup loads the corpus, precomputes every analytics payload, loads the rule
set and the model bundle (training one if it is missing). Failures are recorded
rather than fatal, so ``/health`` can report what is degraded.
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend import rate_limit, schemas
from backend.config import get_settings
from backend.routers import analytics, hazards, model, predict, recommend
from backend.state import state

VERSION = "2.0.0"

logging.basicConfig(
    level=get_settings().log_level,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("disasteriq")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Warm every cache before the first request."""
    settings = get_settings()
    started = time.perf_counter()
    if settings.warm_cache:
        state.warm()
        logger.info("startup complete in %.1fs", time.perf_counter() - started)
        if state.errors:
            logger.warning("degraded components: %s", ", ".join(state.errors))
    yield
    state.reset()


app = FastAPI(
    title="DisasterIQ API",
    version=VERSION,
    description=(
        "Analyse, predict and recommend on disaster response messages. "
        "Multi-label classification with tuned per-label thresholds, weighted "
        "noisy-OR severity, rule-driven action plans and precomputed analytics."
    ),
    lifespan=lifespan,
)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins,
    allow_credentials=_settings.cors_allow_credentials,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
rate_limit.install(app)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Structured access log with a duration, used for basic observability."""
    started = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - started) * 1000
    logger.info(
        "%s %s -> %s in %.1fms",
        request.method, request.url.path, response.status_code, duration_ms,
    )
    response.headers["X-Response-Time-ms"] = f"{duration_ms:.1f}"
    return response


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
    """Readiness probe: reports whether analytics and the model are loaded."""
    return state.health(VERSION)


app.include_router(analytics.router)
app.include_router(predict.router)
app.include_router(recommend.router)
app.include_router(model.router)
app.include_router(hazards.router)
