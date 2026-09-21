"""Human-readable incident summaries, for copy-pasting into a log or handover."""

from __future__ import annotations

from typing import Mapping, Sequence

from backend.etl import META_CATEGORIES


def build_incident_summary(
    message: str,
    severity: Mapping[str, object],
    triggered: Sequence[str],
    event: str | None,
    actions: Sequence[Mapping[str, object]] = (),
    language: Mapping[str, object] | None = None,
) -> str:
    """Compose a short incident note.

    Format is deliberately plain text so it can be pasted into any system.
    """
    level = str(severity.get("level", "low")).upper()
    score = severity.get("score", 0)
    # Meta labels (related, request, ...) describe the message, not a need.
    concrete = [t for t in triggered if t not in META_CATEGORIES]
    needs = ", ".join(t.replace("_", " ") for t in concrete[:6]) or "none identified"
    lines = [
        f"INCIDENT SUMMARY - severity {level} ({score}/100)",
        f"Event context: {event or 'unclassified'}",
        f"Reported needs: {needs}",
    ]
    if language and not language.get("is_english", True):
        lines.append(f"Original language: {language.get('name')}")
    lines.append(f"Message: {message.strip()}")
    if actions:
        lines.append("Recommended actions:")
        for i, action in enumerate(actions[:5], start=1):
            lines.append(
                f"  {i}. [{action.get('urgency_label')}] {action.get('action')} "
                f"- {action.get('agency')}"
            )
    return "\n".join(lines)
