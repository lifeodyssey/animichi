"""Sanctioned fakes for AgentTurn seam tests (TURN-4 #955).

The wiring harness (recording session/settlement/execution ports) and the
turn-input factory — exactly what the use-case seam tests need without
touching the adapter layer.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from animichi.application.agent_turn import AgentTurn
from animichi.application.turn_admission import (
    AdmissionIdentity,
    AdmissionPolicy,
    TurnAdmission,
)
from animichi.application.turn_outcome import TurnOutcome
from animichi.application.turn_types import (
    ExecutionResult,
    PersistOutcome,
    SessionSnapshot,
    SessionUpdate,
    TextTurn,
    TurnInput,
    TurnSideEffects,
)
from animichi.tests.unit.turn_admission_fakes import FakeTurnReservationStore

IDENTITY = AdmissionIdentity(user_id="user-1", user_type="human")


@dataclass
class FakeSettlement:
    """TurnSettlement port recording every side-effect call."""

    calls: list[TurnSideEffects] = field(default_factory=list)

    async def settle(self, side: TurnSideEffects) -> None:
        self.calls.append(side)


class FakeExecution:
    """TurnExecution port: echo the kind, or fail with a code."""

    def __init__(self, *, error_code: str | None = None) -> None:
        self.kinds: list[object] = []
        self.history: list[object] = []
        self.contexts: list[dict[str, object] | None] = []
        self._error_code = error_code

    async def execute(
        self,
        kind: object,
        *,
        context: dict[str, object] | None,
        history: object,
        model: object | None,
        on_step: object | None,
    ) -> ExecutionResult:
        del model, on_step
        self.kinds.append(kind)
        self.contexts.append(context)
        self.history.append(history)
        if self._error_code is not None:
            return ExecutionResult(
                output=None,
                context_delta={},
                intent="error",
                status="error",
                error_code=self._error_code,
            )
        return ExecutionResult(
            output="out",
            context_delta={"delta": 1},
            intent="search_bangumi",
            status="ok",
            new_messages=["m1"],
        )


class FakeSession:
    """SessionGateway port: load/create/persist against an in-memory map."""

    def __init__(self, *, state: dict[str, object] | None = None) -> None:
        self.states: dict[str, dict[str, object]] = {}
        self.persists: list[SessionUpdate] = []
        if state is not None:
            self.states["s-1"] = state

    async def check_owner(self, session_id: str | None, user_id: str | None) -> bool:
        del session_id, user_id
        return True

    async def load(
        self, session_id: str | None, *, user_id: str | None
    ) -> SessionSnapshot:
        del user_id
        if session_id is None:
            return SessionSnapshot(
                session_id=None,
                session_state={},
                context=None,
                history=(),
                is_new=True,
            )
        state = self.states.get(session_id, {})
        return SessionSnapshot(
            session_id=session_id,
            session_state=state,
            context={"loaded": True},
            history=("h1",) if session_id in self.states else (),
        )

    async def persist(self, session_id: str, update: SessionUpdate) -> PersistOutcome:
        self.persists.append(update)
        self.states[session_id] = {"stored": True}
        return PersistOutcome(
            session_state=self.states[session_id], generated_title="Title"
        )


class Harness:
    """One wired AgentTurn with recording fakes."""

    def __init__(
        self,
        store: FakeTurnReservationStore,
        *,
        session_state: dict[str, object] | None = None,
    ) -> None:
        self.store = store
        self.execution = FakeExecution()
        self.session = FakeSession(state=session_state)
        self.settlement = FakeSettlement()
        self.outcome = TurnOutcome(
            store=store, admission=TurnAdmission(store=store, policy=AdmissionPolicy())
        )
        self.agent = AgentTurn(
            outcome=self.outcome,
            session=self.session,
            settlement=self.settlement,
            execution=self.execution,
            detect_injection=lambda text: "ignore all" in text,
            guard_enabled=lambda: True,
            blocked_outcome=lambda _snapshot, _locale: "blocked-out",
            extract_delta=lambda _output: {"session_state_v2": {}},
            timeout=30.0,
        )


def _input(
    *,
    text: str = "京吹",
    session_id: str | None = None,
    expected_revision: int | None = None,
    session_digest: str | None = None,
    request_digest: str | None = None,
) -> TurnInput:
    return TurnInput(
        session_id=session_id,
        turn_key="turn-1",
        identity=IDENTITY,
        kind=TextTurn(text=text, locale="ja"),
        expected_revision=expected_revision,
        session_digest=session_digest,
        request_digest=request_digest,
    )
