"""HandleUserMessage — the application use case for one user-message turn.

Framework-independent: no FastAPI / PydanticAI imports. The model turn is
delegated to an injected :class:`ModelTurnPort` implemented in ``agents/``;
this use case owns input validation and the injection preflight gate.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import structlog

from animichi.application.errors import InvalidInputError
from animichi.application.model_turn_port import (
    ModelTurnPort,
    ModelTurnRequest,
    ModelTurnResult,
)

logger = structlog.get_logger(__name__)

InjectionDetector = Callable[[str], bool]
GuardFlag = Callable[[], bool]
BlockedOutcome = Callable[[], ModelTurnResult]


@dataclass(frozen=True)
class UserMessage:
    """One user message turn, normalized for the use case."""

    text: str
    locale: str
    user_id: str | None = None
    context: dict[str, object] | None = None


@dataclass(frozen=True)
class TurnOutcome:
    """Outcome of one handled turn.

    ``blocked`` is the application gate verdict; ``result`` is the neutral
    model-turn result (its ``output`` is the opaque adapter-side object).
    """

    blocked: bool
    result: ModelTurnResult


class _NullSink:
    """No-op sink for the blocking path (no model turn, no events)."""

    def on_stage(self, stage: str, outcome: str | None = None) -> None: ...

    def on_usage(
        self, completion_tokens: int, prompt_tokens: int, duration_ms: int
    ) -> None: ...


class HandleUserMessage:
    """Use case: gate, then execute, one user-message turn."""

    def __init__(
        self,
        *,
        turn_port: ModelTurnPort,
        blocked_outcome: BlockedOutcome,
        detect_injection: InjectionDetector,
        guard_enabled: GuardFlag,
    ) -> None:
        self._turn_port = turn_port
        self._blocked_outcome = blocked_outcome
        self._detect_injection = detect_injection
        self._guard_enabled = guard_enabled

    async def __call__(self, message: UserMessage) -> TurnOutcome:
        if not message.text.strip():
            raise InvalidInputError("user message text must not be blank", field="text")
        injected = self._detect_injection(message.text)
        if injected:
            logger.warning(
                "input_guardrail_injection_detected", text=message.text[:100]
            )
        blocked = self._guard_enabled() and injected
        if blocked:
            return TurnOutcome(blocked=True, result=self._blocked_outcome())
        result = await self._turn_port.run(
            ModelTurnRequest(text=message.text), events=_NullSink()
        )
        return TurnOutcome(blocked=False, result=result)
