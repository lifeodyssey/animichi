"""AgentTurn replay never re-runs, and a catastrophic settle escape settles failed.

AC3 pins that a replay never re-invokes the execution port; the catastrophic
settle-failed fallback is exercised on the replayed path that a replay settlement
blows up on.
"""

from __future__ import annotations

import pytest

from animichi.application.agent_turn import AgentTurn
from animichi.application.turn_types import ExecutionResult
from animichi.tests.unit.agent_turn_fakes import (
    FakeExecution,
    FakeSettlement,
    Harness,
    _input,
)
from animichi.tests.unit.turn_admission_fakes import FakeTurnReservationStore


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


def _agent(harness: Harness, *, execution: FakeExecution | None = None) -> AgentTurn:
    return AgentTurn(
        outcome=harness.outcome,
        session=harness.session,
        settlement=harness.settlement,
        execution=execution or harness.execution,
        detect_injection=lambda text: "ignore all" in text,
        guard_enabled=lambda: True,
        blocked_outcome=lambda _snapshot, _locale: "blocked-out",
        extract_delta=lambda _output: {"session_state_v2": {}},
        timeout=30.0,
    )


async def test_replay_never_re_invokes_the_execution_port() -> None:
    harness = Harness(FakeTurnReservationStore())
    boom = _BoomOnReplay()
    harness.agent = _agent(harness, execution=boom)

    first = await harness.agent(_input())
    assert first.outcome == "completed"

    # AC3: a replay recovers the committed result WITHOUT re-invoking the
    # model, so the second-call guard never trips and runs stays 1.
    second = await harness.agent(_input())

    assert second.outcome == "replayed"
    assert boom.runs == 1
    assert len(harness.session.persists) == 1


async def test_catastrophic_settlement_escape_on_replay_settles_failed() -> None:
    harness = Harness(FakeTurnReservationStore())

    class _BoomOnReplaySettlement(FakeSettlement):
        boots = 0

        async def settle(self, side) -> None:
            del side
            self.boots += 1
            if self.boots > 1:
                raise RuntimeError("settle boom")

    boom_settlement = _BoomOnReplaySettlement()
    harness.settlement = boom_settlement
    harness.agent = _agent(harness)
    first = await harness.agent(_input())
    assert first.outcome == "completed"

    with pytest.raises(RuntimeError, match="settle boom"):
        await harness.agent(_input())
    # terminal settle + the catastrophic settle_failed fallback both fire.
    assert boom_settlement.boots == 3
