"""Language detection and best-effort translation.

The corpus is multilingual (Haitian Creole, French, Urdu, Spanish, ...) and the
classifier is trained on the English column, so a non-English message is
translated before classification when a translator is available.

Everything here degrades gracefully: if no detector or translator is installed
the API still answers, with ``translation_available: false``. Nothing in this
module raises to the caller.
"""

from __future__ import annotations

import logging
import re
from functools import lru_cache
from typing import Any

from backend.config import get_settings

logger = logging.getLogger(__name__)

LANGUAGE_NAMES: dict[str, str] = {
    "en": "English", "fr": "French", "ht": "Haitian Creole", "es": "Spanish",
    "ur": "Urdu", "hi": "Hindi", "te": "Telugu", "ta": "Tamil", "bn": "Bengali",
    "pt": "Portuguese", "ar": "Arabic", "ne": "Nepali", "id": "Indonesian",
    "sw": "Swahili", "tl": "Tagalog", "de": "German", "it": "Italian",
    "nl": "Dutch", "ru": "Russian", "zh-cn": "Chinese", "ja": "Japanese",
    "ko": "Korean", "tr": "Turkish", "vi": "Vietnamese", "th": "Thai",
    "mr": "Marathi", "gu": "Gujarati", "kn": "Kannada", "ml": "Malayalam",
    "pa": "Punjabi", "so": "Somali", "fa": "Persian",
}

# Words that are common in Haitian Creole but not in French, used to correct
# langdetect, which has no Creole model and reports French or Italian instead.
_CREOLE_MARKERS = re.compile(
    r"\b(nou|mwen|yo|ki|pou|nan|gen|pa\s+gen|anpil|moun|tanpri|kounye|"
    r"jodi|mesi|ede|manje|dlo|kay|timoun|fanmi|sil\s?vou\s?ple)\b",
    re.I,
)


#: MyMemory expects locale codes rather than bare ISO-639-1 codes.
MYMEMORY_LOCALES: dict[str, str] = {
    "fr": "fr-FR", "ht": "ht-HT", "es": "es-ES", "ur": "ur-PK", "hi": "hi-IN",
    "te": "te-IN", "ta": "ta-IN", "bn": "bn-IN", "pt": "pt-PT", "ar": "ar-SA",
    "ne": "ne-NP", "id": "id-ID", "sw": "sw-KE", "tl": "tl-PH", "de": "de-DE",
    "it": "it-IT", "nl": "nl-NL", "ru": "ru-RU", "zh-cn": "zh-CN", "ja": "ja-JP",
    "ko": "ko-KR", "tr": "tr-TR", "vi": "vi-VN", "th": "th-TH", "mr": "mr-IN",
    "gu": "gu-IN", "kn": "kn-IN", "ml": "ml-IN", "pa": "pa-IN", "so": "so-SO",
    "fa": "fa-IR",
}


def language_name(code: str) -> str:
    """Human-readable language name for a code."""
    return LANGUAGE_NAMES.get(code, code.upper() if code else "Unknown")


@lru_cache(maxsize=1)
def _detector_available() -> bool:
    try:
        import langdetect  # noqa: F401

        return True
    except Exception:  # noqa: BLE001
        return False


def detect_language(text: str) -> dict[str, Any]:
    """Detect the language of a message.

    Returns ``{code, name, confidence, is_english, detector}``. Short strings
    and detector failures fall back to ``en`` with low confidence rather than
    raising, because a wrong classification is better than a 500.
    """
    clean = (text or "").strip()
    if len(clean) < 12 or not _detector_available():
        return {
            "code": "en", "name": "English", "confidence": 0.0,
            "is_english": True, "detector": "fallback",
        }
    try:
        from langdetect import DetectorFactory, detect_langs

        DetectorFactory.seed = 0
        best = detect_langs(clean)[0]
        code, confidence = best.lang, float(best.prob)
    except Exception:  # noqa: BLE001 - detector is best-effort
        return {
            "code": "en", "name": "English", "confidence": 0.0,
            "is_english": True, "detector": "fallback",
        }

    # langdetect has no Haitian Creole model and reports French, Italian or
    # other Romance languages instead; the marker words are decisive.
    if code != "ht" and len(_CREOLE_MARKERS.findall(clean)) >= 2:
        code, confidence = "ht", max(confidence, 0.6)

    return {
        "code": code,
        "name": language_name(code),
        "confidence": round(confidence, 3),
        "is_english": code == "en",
        "detector": "langdetect",
    }


@lru_cache(maxsize=1)
def _argos_pairs() -> dict[tuple[str, str], Any]:
    """Installed Argos Translate packages, keyed by (from, to)."""
    try:
        import argostranslate.translate as argos

        return {
            (lang.code, target.code): target
            for lang in argos.get_installed_languages()
            for target in lang.translations_to()
        } if hasattr(argos, "get_installed_languages") else {}
    except Exception:  # noqa: BLE001
        return {}


def translator_status() -> dict[str, Any]:
    """Which translation backends are usable right now."""
    settings = get_settings()
    argos = bool(_argos_pairs())
    deep = False
    try:
        import deep_translator  # noqa: F401

        deep = True
    except Exception:  # noqa: BLE001
        deep = False
    return {
        "enabled": settings.translation_enabled,
        "detector": "langdetect" if _detector_available() else "none",
        "backends": [n for n, ok in (("argos", argos), ("deep-translator", deep)) if ok],
        "available": settings.translation_enabled and (argos or deep),
    }


#: Online fallbacks, tried in order. Each is (name, factory) where the factory
#: takes the detected source code and returns an object with ``.translate``.
def _online_backends(source: str) -> list[tuple[str, Any]]:
    from deep_translator import GoogleTranslator, MyMemoryTranslator

    return [
        ("google", lambda: GoogleTranslator(source="auto", target="en")),
        (
            "mymemory",
            lambda: MyMemoryTranslator(
                source=MYMEMORY_LOCALES.get(source, source), target="en-US"
            ),
        ),
    ]


def translate_to_english(text: str, source: str) -> dict[str, Any]:
    """Translate to English, trying offline Argos first, then online backends.

    Returns ``{text, translated, backend, error}``. ``text`` is always usable:
    on failure it is the original message. Rate limits and offline machines are
    expected, so every failure is swallowed and reported in ``error``.
    """
    settings = get_settings()
    result = {"text": text, "translated": False, "backend": None, "error": None}
    if not settings.translation_enabled or source in {"en", "", None}:
        return result

    pairs = _argos_pairs()
    for source_code in (source, source.split("-")[0]):
        if (source_code, "en") not in pairs:
            continue
        try:
            import argostranslate.translate as argos

            out = argos.translate(text, source_code, "en")
            if out:
                return {"text": out, "translated": True, "backend": "argos", "error": None}
        except Exception as exc:  # noqa: BLE001 - optional offline backend
            logger.debug("argos translation failed: %s", exc)

    try:
        from backend.model.predictors import enable_system_certificates

        enable_system_certificates()
        backends = _online_backends(source)
    except Exception:  # noqa: BLE001 - deep-translator not installed
        backends = []

    for name, factory in backends:
        try:
            out = factory().translate(text)
            if out and out.strip():
                return {
                    "text": out, "translated": True, "backend": name, "error": None,
                }
        except Exception as exc:  # noqa: BLE001 - rate limits are expected
            result["error"] = f"translation unavailable ({type(exc).__name__})"
            logger.debug("%s translation failed: %s", name, exc)

    if result["error"] is None:
        result["error"] = "no translation backend installed"
    return result


def prepare_for_classification(text: str) -> dict[str, Any]:
    """Detect the language and return the text the classifier should see."""
    detection = detect_language(text)
    if detection["is_english"]:
        return {
            "language": detection,
            "text_for_model": text,
            "translation": {"text": None, "translated": False, "backend": None, "error": None},
        }
    translation = translate_to_english(text, detection["code"])
    return {
        "language": detection,
        "text_for_model": translation["text"] if translation["translated"] else text,
        "translation": translation,
    }
