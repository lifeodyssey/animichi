"""Neutral turn types and ports (TURN-4 #955).

The turn kinds (TextTurn / PointSelectionTurn / CandidateSelectionTurn), the
neutral request/result envelopes, and the application ports the use case
speaks (SessionGateway, TurnSettlement, TurnExecution). Framework-independent:
no FastAPI / PydanticAI imports — the adapter layer implements the ports.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Literal, Protocol

import structlog

from animichi.application.turn_admission import (
    AdmissionIdentity,
    AdmissionRejection,
    AdmissionVerdict,
)
from animichi.application.turn_outcome import TurnOutcome
from animichi.application.turn_outcome_port import TurnRef

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class TextTurn:
    """One user-message turn, executed through ModelTurnPort."""

    text: str
    locale: str = "ja"
    include_debug: bool = False
    origin: str | None = None
    origin_lat: float | None = None
    origin_lng: float | None = None


@dataclass(frozen=True)
class PointSelectionTurn:
    """Deterministic selected-point itinerary turn (no model run)."""

    point_ids: tuple[str, ...]
    locale: str = "ja"
    origin: str | None = None


@dataclass(frozen=True)
class CandidateSelectionTurn:
    """Deterministic clarify-card selection turn (no model run)."""

    candidate_ids: tuple[str, ...]
    clarification_id: int
    locale: str = "ja"


TurnKind = TextTurn | PointSelectionTurn | CandidateSelectionTurn


@dataclass(frozen=True)
class TurnInput:
    """One caller turn: admission headers, identity, and the typed kind."""

    session_id: str | None
    turn_key: str
    identity: AdmissionIdentity
    kind: TurnKind
    expected_revision: int | None = None
    session_digest: str | None = None
    is_byok: bool = False
    model: object | None = None
    verdict: AdmissionVerdict | None = None


@dataclass(frozen=True)
class ReservationBinding:
    """A route-granted reservation (outcome + ref + owner) driving the turn.

    The route admits before any stream starts and hands the granted lease in;
    when no binding is present the use case admits (and derives the ref)
    itself for direct callers.
    """

    outcome: TurnOutcome
    ref: TurnRef
    owner: str


@dataclass(frozen=True)
class SessionUpdate:
    """Neutral persistence carrier for one completed turn.

    ``output`` is the opaque execution output the adapter may need while
    persisting (e.g. itinerary archiving); it is never interpreted here.
    """

    request_text: str
    response_intent: str
    response_status: str
    response_success: bool
    response_message: str = ""
    context_delta: dict[str, object] | None = None
    new_messages: Sequence[object] = field(default_factory=tuple)
    output: object | None = None


@dataclass(frozen=True)
class SessionSnapshot:
    """A loaded (or freshly created) session and its derived context."""

    session_id: str | None
    session_state: dict[str, object]
    context: dict[str, object] | None
    history: Sequence[object]
    is_new: bool = False


@dataclass(frozen=True)
class PersistOutcome:
    """The stored session envelope plus its generated title."""

    session_state: dict[str, object]
    generated_title: str | None = None
    user_message_persisted: bool = True


TurnOutcomeLabel = Literal[
    "completed",
    "replayed",
    "rejected",
    "blocked",
    "lease_lost",
    "error",
]


@dataclass(frozen=True)
class TurnResult:
    """Outcome of one handled turn.

    ``output`` is the opaque execution output (the adapter builds its wire
    response from it); ``rejection`` carries the admission refusal;
    ``revision`` is the session revision to echo for the next turn;
    ``persisted`` is the stored session envelope for response assembly.
    """

    outcome: TurnOutcomeLabel
    output: object | None = None
    rejection: AdmissionRejection | None = None
    session_id: str | None = None
    revision: int | None = None
    error_code: str | None = None
    error_details: dict[str, object] | None = None
    persisted: PersistOutcome | None = None


@dataclass(frozen=True)
class TurnStageEvent:
    """Neutral stream event; the SSE adapter translates it to tool parts."""

    tool: str
    call_id: str
    status: str
    data: dict[str, object] | None = None


TurnStageSink = Callable[[TurnStageEvent], Awaitable[None]]


class SessionGateway(Protocol):
    """Port: load/create/persist session state across the turn."""

    async def check_owner(
        self, session_id: str | None, user_id: str | None
    ) -> bool: ...

    async def load(
        self,
        session_id: str | None,
        *,
        user_id: str | None,
    ) -> SessionSnapshot: ...

    async def persist(
        self, session_id: str, update: SessionUpdate
    ) -> PersistOutcome: ...


@dataclass(frozen=True)
class TurnSideEffects:
    """Neutral settlement inputs (usage metering / quota / audit)."""

    result: object | None
    session_id: str | None
    user_id: str | None
    user_type: str | None
    is_byok: bool
    settle_quota: bool
    elapsed_ms: int
    intent: str
    status: str
    request_text: str
    user_message_persisted: bool = True


class TurnSettlement(Protocol):
    """Port: exactly-once terminal side effects for a settled turn."""

    async def settle(self, side: TurnSideEffects) -> None: ...


@dataclass(frozen=True)
class ExecutionResult:
    """One executed turn kind plus its derived context delta.

    ``error_code`` distinguishes a response-producing failure (timeout,
    invalid selection, provider, application error) from a normal turn; the
    output is then ``None`` and the adapter maps the code to its wire error.
    ``new_messages`` carries the serialized model messages for persistence.
    """

    output: object | None
    context_delta: dict[str, object]
    intent: str
    status: str
    error_code: str | None = None
    error_details: dict[str, object] | None = None
    new_messages: Sequence[object] = field(default_factory=tuple)


class TurnExecution(Protocol):
    """Port: execute one typed turn kind (adapter owns framework types)."""

    async def execute(
        self,
        kind: TurnKind,
        *,
        context: dict[str, object] | None,
        history: Sequence[object],
        model: object | None,
        on_step: TurnStageSink | None,
    ) -> ExecutionResult: ...


class TurnSelectionError(ValueError):
    """A stale or invalid candidate/point selection (application boundary)."""


def _request_text(turn: TurnInput) -> str:
    return turn.kind.text if isinstance(turn.kind, TextTurn) else ""
