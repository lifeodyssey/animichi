"""Neutral model-turn port (TURN-1 #939).

The application layer speaks this port; the production adapter
(``animichi.agents.animichi_runner``) owns every PydanticAI type. No
pydantic_ai import may appear in this module or any consumer of it.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol

from animichi.application.turn_event_sink import TurnEventSink


@dataclass(frozen=True)
class ModelTurnRequest:
    """Neutral input for one model turn.

    ``message_history`` is the application's own neutral history shape
    (list of message strings / tool frames); the adapter converts it to
    PydanticAI ``ModelMessage``. Never contains prompts of other actors.
    """

    text: str
    message_history: Sequence[object] = field(default_factory=tuple)


@dataclass(frozen=True)
class ModelTurnUsage:
    """Neutral token accounting (counts only, never content)."""

    completion_tokens: int = 0
    prompt_tokens: int = 0


@dataclass(frozen=True)
class ModelTurnResult:
    """Outcome of one model turn.

    ``output`` is the opaque application-level output object; ``cancelled``
    distinguishes an interrupted turn from a normal error outcome.
    """

    output: object
    usage: ModelTurnUsage
    cancelled: bool = False


class ModelTurnError(Exception):
    """Base class for neutral turn failures."""


class ModelTurnUsageError(ModelTurnError):
    """The turn hit its usage limit."""


class ModelTurnProviderError(ModelTurnError):
    """The provider failed (transport, HTTP, or unexpected model behavior)."""


class ModelTurnPort(Protocol):
    """Port: execute one model turn, emitting neutral events.

    Implemented by ``PydanticAIModelTurnPort`` in
    ``animichi.agents.animichi_runner``.
    """

    async def run(
        self, request: ModelTurnRequest, *, events: TurnEventSink
    ) -> ModelTurnResult: ...
