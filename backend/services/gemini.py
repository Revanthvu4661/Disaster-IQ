"""The one place the backend calls Google Gemini.

The API key comes from GEMINI_API_KEY (backend/.env or the environment) and
is sent in a request header; it never reaches the browser. Callers build the
prompt server-side and get parsed JSON back, or a GeminiUnavailable carrying
the HTTP status to answer with.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from backend.config import get_settings

logger = logging.getLogger("disasteriq.gemini")

URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# Gemini 2.5 models think before answering; 20-40 s is normal.
TIMEOUT_SECONDS = 60


class GeminiUnavailable(RuntimeError):
    """Gemini is not configured, or did not return a usable answer."""

    def __init__(self, message: str, status: int = 503) -> None:
        super().__init__(message)
        self.status = status


def configured() -> bool:
    return bool(get_settings().gemini_api_key)


def model() -> str:
    return get_settings().gemini_model


def generate_json(prompt: str, client: httpx.Client | None = None, what: str = "The AI answer") -> Any:
    """Send one prompt, ask for JSON back, and return it parsed."""
    settings = get_settings()
    if not settings.gemini_api_key:
        raise GeminiUnavailable("The AI service is not configured: set GEMINI_API_KEY in backend/.env.")
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.4}}
    owns_client = client is None
    client = client or httpx.Client(timeout=TIMEOUT_SECONDS)
    try:
        response = client.post(URL.format(model=settings.gemini_model), json=body,
                               headers={"x-goog-api-key": settings.gemini_api_key})
    except httpx.HTTPError as error:
        logger.warning("Gemini request failed: %s", error)
        raise GeminiUnavailable("The AI service could not be reached. Try again later.", 502) from error
    finally:
        if owns_client:
            client.close()
    if response.status_code != 200:
        logger.warning("Gemini answered HTTP %s: %s", response.status_code, response.text[:300])
        raise GeminiUnavailable(f"The AI service answered with an error (HTTP {response.status_code}).", 502)
    try:
        text = response.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        if text.startswith("```"):
            text = text.strip("`").removeprefix("json").strip()
        return json.loads(text)
    except (KeyError, IndexError, TypeError, ValueError) as error:
        logger.warning("Gemini answer was not the expected JSON: %s", error)
        raise GeminiUnavailable(f"{what} could not be read. Try again.", 502) from error
