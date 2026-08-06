"""HandleUserMessage — the application use case for one user-message turn.

Framework-independent: this module imports no FastAPI / PydanticAI runtime
and no ``clients/`` HTTP adapter. The model turn itself is delegated to an
injected :class:`TurnExecutor` port whose single production implementation
lives in ``agents/`` — the PydanticAI/FastAPI **framework adapter** (see
``agents/README.md``). This use case owns the deterministic part of the
turn lifecycle: input validation and the injection preflight gate.

TODO(refactor-skeleton): later slices move the remaining deterministic
post-processing (terminal-status derivation, partial/blocked result
normalization, session fixups) in here as the adapter's result types become
framework-neutral.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Generic, Protocol, TypeVar, runtime_checkable

import structlog

from animichi.application.errors import InvalidInputError

logger = structlog.get_logger(__name__)

ResultT = TypeVar("ResultT")

InjectionDetector = Callable[[str], bool]
GuardFlag = Callable[[], bool]


@dataclass(frozen=True)
class UserMessage:
    """One user message turn, normalized for the use case."""

    text: str
    locale: str
    user_id: str | None = None
    context: dict[str, object] | None = None


@dataclass(frozen=True)
class TurnOutcome(Generic[ResultT]):
    """Outcome of one handled turn.

    ``blocked`` is the application gate verdict; ``result`` is the opaque
    adapter-side turn result (an ``AgentResult`` in the production adapter).
    """

    blocked: bool
    result: ResultT


@runtime_checkable
class TurnExecutor(Protocol[ResultT]):
    """Port: execute one model turn, or its blocked short-circuit.

    Implemented by ``animichi.agents.animichi_runner``; the PydanticAI run,
    memory capability, and typed result assembly stay in that adapter.
    """

    async def __call__(
        self, message: UserMessage, *, blocked: bool
    ) -> TurnOutcome[ResultT]: ...


class HandleUserMessage(Generic[ResultT]):
    """Use case: gate, then execute, one user-message turn.

    The executor decides how a blocked turn materializes (the production
    adapter short-circuits the model with a ``BlockedResponseModel``); the
    use case only computes the verdict.
    """

    def __init__(
        self,
        *,
        execute_turn: TurnExecutor[ResultT],
        detect_injection: InjectionDetector,
        guard_enabled: GuardFlag,
    ) -> None:
        self._execute_turn = execute_turn
        self._detect_injection = detect_injection
        self._guard_enabled = guard_enabled

    async def __call__(self, message: UserMessage) -> TurnOutcome[ResultT]:
        if not message.text.strip():
            raise InvalidInputError("user message text must not be blank", field="text")
        injected = self._detect_injection(message.text)
        if injected:
            logger.warning(
                "input_guardrail_injection_detected", text=message.text[:100]
            )
        blocked = self._guard_enabled() and injected
        return await self._execute_turn(message, blocked=blocked)
