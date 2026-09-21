"""Language detection and the translation fallback chain."""

from __future__ import annotations

import pytest

from backend.services import language as lang


def test_english_is_detected() -> None:
    result = lang.detect_language("We urgently need drinking water and food supplies")
    assert result["is_english"] and result["code"] == "en"


def test_short_text_falls_back_to_english() -> None:
    result = lang.detect_language("hi")
    assert result["detector"] == "fallback" and result["is_english"]


def test_empty_text_does_not_raise() -> None:
    assert lang.detect_language("")["code"] == "en"


def test_creole_is_corrected_from_romance_languages() -> None:
    result = lang.detect_language("Nou bezwen dlo ak manje nan Jacmel, tanpri ede nou")
    assert result["code"] == "ht" and result["name"] == "Haitian Creole"


def test_spanish_is_detected() -> None:
    detected = lang.detect_language("Necesitamos agua y comida urgentemente por favor")
    assert detected["code"] == "es"


def test_language_name_falls_back_to_the_code() -> None:
    assert lang.language_name("xx") == "XX"
    assert lang.language_name("hi") == "Hindi"


def test_translator_status_shape() -> None:
    status = lang.translator_status()
    assert set(status) == {"enabled", "detector", "backends", "available"}


def test_english_is_never_translated() -> None:
    result = lang.translate_to_english("We need water", "en")
    assert result["translated"] is False and result["text"] == "We need water"


def test_translation_failure_is_swallowed(monkeypatch: pytest.MonkeyPatch) -> None:
    """A dead backend must degrade to the original text, not raise."""

    class Boom:
        def translate(self, _text: str) -> str:
            raise RuntimeError("network down")

    monkeypatch.setattr(lang, "_online_backends", lambda source: [("boom", Boom)])
    result = lang.translate_to_english("Necesitamos agua", "es")
    assert result["translated"] is False
    assert result["text"] == "Necesitamos agua"
    assert "unavailable" in result["error"]


def test_translation_uses_the_first_working_backend(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Dead:
        def translate(self, _text: str) -> str:
            raise RuntimeError("rate limited")

    class Works:
        def translate(self, _text: str) -> str:
            return "We need water"

    monkeypatch.setattr(
        lang, "_online_backends", lambda source: [("dead", Dead), ("works", Works)]
    )
    result = lang.translate_to_english("Necesitamos agua", "es")
    assert result == {
        "text": "We need water",
        "translated": True,
        "backend": "works",
        "error": None,
    }


def test_prepare_for_classification_passes_english_through() -> None:
    prepared = lang.prepare_for_classification("We need water at the clinic today")
    assert prepared["text_for_model"] == "We need water at the clinic today"
    assert prepared["translation"]["translated"] is False


def test_prepare_uses_the_translation_when_available(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Works:
        def translate(self, _text: str) -> str:
            return "We need water"

    monkeypatch.setattr(lang, "_online_backends", lambda source: [("works", Works)])
    prepared = lang.prepare_for_classification("Necesitamos agua urgentemente ahora")
    assert prepared["text_for_model"] == "We need water"
    assert not prepared["language"]["is_english"]
    assert prepared["translation"]["backend"] == "works"


def test_translation_disabled_by_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = lang.get_settings()
    monkeypatch.setattr(settings, "translation_enabled", False)
    result = lang.translate_to_english("Necesitamos agua", "es")
    assert result["translated"] is False
