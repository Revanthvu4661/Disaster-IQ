"""Rate limiting for the prediction endpoints.

``slowapi`` is optional: when it is not installed the decorators become no-ops
so the API still runs (useful for minimal deployments and tests).
"""

from __future__ import annotations

import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)

try:  # pragma: no cover - exercised by whichever branch the env provides
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from slowapi.util import get_remote_address

    SLOWAPI_AVAILABLE = True
    limiter = Limiter(key_func=get_remote_address, default_limits=[])
except Exception:  # noqa: BLE001 - optional dependency
    SLOWAPI_AVAILABLE = False
    RateLimitExceeded = None  # type: ignore[assignment]
    _rate_limit_exceeded_handler = None  # type: ignore[assignment]

    class _NoopLimiter:
        """Stand-in with the same decorator surface as ``slowapi.Limiter``."""

        enabled = False

        def limit(self, *_args: Any, **_kwargs: Any) -> Callable:
            def decorator(func: Callable) -> Callable:
                return func

            return decorator

    limiter = _NoopLimiter()  # type: ignore[assignment]
    logger.info("slowapi not installed; rate limiting disabled")


def install(app: Any) -> None:
    """Attach the limiter and its 429 handler to a FastAPI app."""
    if not SLOWAPI_AVAILABLE:
        return
    from slowapi.middleware import SlowAPIMiddleware

    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)
