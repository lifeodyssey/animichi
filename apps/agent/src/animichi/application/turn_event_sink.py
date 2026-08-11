"""Neutral turn event sink (TURN-1 #939).

Sink events carry stage, outcome, and counts only — never prompt text,
actor identity, or credential data. The production adapter bridges this
sink to the model provider's own event stream.
"""

from __future__ import annotations

from typing import Protocol


class TurnEventSink(Protocol):
    """Protocol: receive neutral lifecycle events for one model turn."""

    def on_stage(self, stage: str, outcome: str | None = None) -> None:
        """Record a turn stage transition (e.g. running -> terminal)."""

    def on_usage(
        self, completion_tokens: int, prompt_tokens: int, duration_ms: int
    ) -> None:
        """Record token usage and wall-clock duration (counts only)."""
