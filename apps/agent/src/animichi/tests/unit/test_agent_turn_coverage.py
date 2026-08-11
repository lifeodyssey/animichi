"""AgentTurn error-path branches (TURN-4 #955 coverage loop).

Pins the paths the existing seam tests leave open: the session-load failure
release, input/application errors escaping execution, the best-effort error
persist failure, the non-reserved catastrophic settle, and the unbounded
(timeout=None) execution path.
"""

from __future__ import annotations

import pytest

from animichi.application.agent_turn import AgentTurn
from animichi.application.errors import ApplicationError
from animichi.application.turn_types import ExecutionResult
from animichi.tests.unit.agent_turn_fakes import (
    FakeExecution,
    FakeSession,
    Harness,
    _input,
)
from animichi.tests.unit.turn_admission_fakes import FakeTurnReservationStore


class _LoadFailingSession(FakeSession):
    async def load(self, session_id: str | None, *, user_id: str | None):
        del session_id, user_id
        raise RuntimeError("session store down")


class _LoadFailsOnSecond(FakeSession):
    def __init__(self) -> None:
        super().__init__()
        self.loads = 0

    async def load(self, session_id: str | None, *, user_id: str | None):
        self.loads += 1
        if self.loads == 2:
            raise RuntimeError("session store down")
        return await super().load(session_id, user_id=user_id)


class _AppErrorExecution(FakeExecution):
    async def execute(self, kind, *, context, history, model, on_step):
        del kind, context, history, model, on_step
        raise ApplicationError("quota exceeded", details={"scope": "anon"})


class _PersistFailingSession(FakeSession):
    async def persist(self, session_id: str, update):
        del session_id, update
        raise OSError("disk full")


class _BoomOnReplay(FakeExecution):
    def __init__(self) -> None:
        super().__init__()
        self.runs = 0

    async def execute(self, kind, *, context, history, model, on_step):
        del kind, context, history, model, on_step
        self.runs += 1
        if self.runs > 1:
            raise RuntimeError("replay boom")
        return ExecutionResult(output="out", context_delta={}, intent="ok", status="ok")


def _agent(
    harness: Harness,
    *,
    session: FakeSession | None = None,
    execution: FakeExecution | None = None,
    timeout: float | None = 30.0,
) -> AgentTurn:
    return AgentTurn(
        outcome=harness.outcome,
        session=session or harness.session,
        settlement=harness.settlement,
        execution=execution or harness.execution,
        detect_injection=lambda text: "ignore all" in text,
        guard_enabled=lambda: True,
        blocked_outcome=lambda _snapshot, _locale: "blocked-out",
        extract_delta=lambda _output: {"session_state_v2": {}},
        timeout=timeout,
    )


async def test_session_load_failure_releases_the_reservation_then_reraises() -> None:
    harness = Harness(FakeTurnReservationStore())
    harness.agent = _agent(harness, session=_LoadFailingSession())

    with pytest.raises(RuntimeError, match="session store down"):
        await harness.agent(_input(session_id="s-1"))

    assert harness.store.release_calls[0][:2] == ("s-1", "turn-1")
    assert harness.store.settle_calls == []
    assert harness.settlement.calls == []


async def test_replay_session_load_failure_reraised_without_release() -> None:
    harness = Harness(FakeTurnReservationStore())
    harness.agent = _agent(harness, session=_LoadFailsOnSecond())

    first = await harness.agent(_input())
    assert first.outcome == "completed"
    harness.store.release_calls.clear()

    with pytest.raises(RuntimeError, match="session store down"):
        await harness.agent(_input())

    assert harness.store.release_calls == []
    assert len(harness.settlement.calls) == 1


async def test_blank_text_is_rejected_as_an_invalid_input_error_turn() -> None:
    harness = Harness(FakeTurnReservationStore())

    result = await harness.agent(_input(text="   "))

    assert result.outcome == "error"
    assert result.error_code == "invalid_input"
    assert result.error_details == {"field": "text"}
    assert harness.execution.kinds == []
    assert harness.store.settle_calls[0][3] == "completed"


async def test_application_error_from_execution_is_mapped_to_an_error_turn() -> None:
    harness = Harness(FakeTurnReservationStore())
    harness.agent = _agent(harness, execution=_AppErrorExecution())

    result = await harness.agent(_input(session_id="s-1"))

    assert result.outcome == "error"
    assert result.error_code == "internal_error"
    assert result.error_details == {"scope": "anon"}
    assert harness.store.settle_calls[0][3] == "completed"


async def test_error_turn_persist_failure_is_absorbed_and_still_settles() -> None:
    harness = Harness(FakeTurnReservationStore())
    harness.agent = _agent(
        harness,
        session=_PersistFailingSession(),
        execution=FakeExecution(error_code="provider_error"),
    )

    result = await harness.agent(_input(session_id="s-1"))

    assert result.outcome == "error"
    assert result.error_code == "provider_error"
    assert result.persisted is None
    assert harness.store.settle_calls[0][3] == "completed"


async def test_catastrophic_escape_on_replay_settles_without_reservation() -> None:
    harness = Harness(FakeTurnReservationStore())
    boom = _BoomOnReplay()
    harness.agent = _agent(harness, execution=boom)

    first = await harness.agent(_input())
    assert first.outcome == "completed"

    with pytest.raises(RuntimeError, match="replay boom"):
        await harness.agent(_input())

    assert harness.settlement.calls[-1].settle_quota is False
    assert harness.settlement.calls[-1].status == "error"


async def test_timeout_none_runs_execution_without_wait_for() -> None:
    harness = Harness(FakeTurnReservationStore())
    harness.agent = _agent(harness, timeout=None)

    result = await harness.agent(_input(session_id="s-1"))

    assert result.outcome == "completed"
    assert result.output == "out"
