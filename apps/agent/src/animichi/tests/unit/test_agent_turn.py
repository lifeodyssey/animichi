"""AgentTurn lifecycle (TURN-4 #955): admission, dispatch, settle, replay.

The use case owns one turn through Session, Catalog, ModelTurnPort, and
TurnOutcome. These tests pin initial/continued turns, replay without
dispatch/quota, and the CAS revision/digest rejections.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from typing import cast

from animichi.application.agent_turn import AgentTurn
from animichi.application.turn_types import ExecutionResult, TextTurn, TurnExecution
from animichi.interfaces.schemas import PublicAPIResponse
from animichi.tests.unit.agent_turn_fakes import Harness, _input
from animichi.tests.unit.turn_admission_fakes import FakeTurnReservationStore


async def test_initial_turn_admits_dispatches_and_settles_completed_once() -> None:
    harness = Harness(FakeTurnReservationStore())

    result = await harness.agent(_input(session_id="s-1"))

    assert result.outcome == "completed"
    assert result.output == "out"
    assert result.revision == 1
    assert harness.session.persists[0].request_text == "京吹"
    assert harness.session.persists[0].response_intent == "search_bangumi"
    assert harness.store.dispatch_calls[0][:2] == ("s-1", "turn-1")
    granted_owner = harness.store.dispatch_calls[0][2]
    assert granted_owner is not None
    assert harness.store.settle_calls[0][:2] == ("s-1", "turn-1")
    assert harness.store.settle_calls[0][2] == granted_owner
    assert harness.store.settle_calls[0][3] == "completed"
    assert len(harness.settlement.calls) == 1
    assert harness.settlement.calls[0].settle_quota is True
    assert harness.settlement.calls[0].result == "out"
    assert harness.execution.kinds == [TextTurn(text="京吹", locale="ja")]
    assert list(cast(Sequence[object], harness.execution.history[0])) == []


async def test_continued_turn_loads_the_existing_session_context() -> None:
    harness = Harness(FakeTurnReservationStore(), session_state={"stored": True})

    result = await harness.agent(_input(session_id="s-1"))

    assert result.outcome == "completed"
    assert harness.execution.contexts == [{"loaded": True}]
    assert list(cast(Sequence[object], harness.execution.history[0])) == ["h1"]
    assert harness.settlement.calls[0].session_id == "s-1"


async def test_every_text_command_routes_through_the_execution_port() -> None:
    for text in ["聖地を探して", "プランを立てて", "hello", "こんにちは"]:
        harness = Harness(FakeTurnReservationStore())

        await harness.agent(_input(text=text))

        assert harness.execution.kinds == [TextTurn(text=text, locale="ja")]


async def test_replay_runs_direct_without_dispatch_or_quota_settlement() -> None:
    harness = Harness(FakeTurnReservationStore())
    await harness.agent(_input())
    harness.store.dispatch_calls.clear()
    harness.store.settle_calls.clear()
    harness.settlement.calls.clear()

    result = await harness.agent(_input())

    assert result.outcome == "replayed"
    assert result.revision == 1
    assert harness.store.dispatch_calls == []
    assert harness.store.settle_calls == []
    assert harness.settlement.calls[0].settle_quota is False


async def test_stale_revision_is_rejected_before_any_dispatch() -> None:
    store = FakeTurnReservationStore()
    store.session_state["s-1"] = {"state": "earlier"}
    harness = Harness(store)

    result = await harness.agent(_input(session_id="s-1", expected_revision=1))

    assert result.outcome == "rejected"
    assert result.rejection is not None
    assert result.rejection.reason == "stale_revision"
    assert harness.store.dispatch_calls == []
    assert harness.store.settle_calls == []
    assert harness.settlement.calls == []
    assert harness.execution.kinds == []


async def test_digest_mismatch_is_rejected_before_any_dispatch() -> None:
    store = FakeTurnReservationStore()
    store.session_state["s-1"] = {"state": "x"}
    harness = Harness(store)

    result = await harness.agent(_input(session_id="s-1", session_digest="deadbeef"))

    assert result.outcome == "rejected"
    assert result.rejection is not None
    assert result.rejection.reason == "digest_mismatch"
    assert harness.store.dispatch_calls == []
    assert harness.execution.kinds == []


async def test_replay_recovers_the_committed_output_payload() -> None:
    harness = Harness(FakeTurnReservationStore())

    first = await harness.agent(_input())
    assert first.outcome == "completed"

    second = await harness.agent(_input())

    assert second.outcome == "replayed"
    assert second.output == "out"
    assert second.revision == first.revision


async def test_replay_with_a_different_request_digest_is_rejected_as_conflict() -> None:
    harness = Harness(FakeTurnReservationStore())

    first = await harness.agent(_input(request_digest="digest-a"))
    assert first.outcome == "completed"
    harness.store.dispatch_calls.clear()
    harness.store.settle_calls.clear()

    result = await harness.agent(_input(request_digest="digest-b"))

    assert result.outcome == "rejected"
    assert result.rejection is not None
    assert result.rejection.reason == "request_conflict"
    assert harness.store.dispatch_calls == []
    assert harness.store.settle_calls == []
    assert harness.execution.kinds == [TextTurn(text="京吹", locale="ja")]


async def test_concurrent_duplicate_turns_produce_one_of_each() -> None:
    harness = Harness(FakeTurnReservationStore())

    results = await asyncio.gather(
        harness.agent(_input(session_id="s-1")),
        harness.agent(_input(session_id="s-1")),
    )

    outcomes = [r.outcome for r in results]
    assert outcomes.count("completed") == 1
    # The loser either races (in-flight rejection) or replays after the winner
    # committed — either way it never executes again.
    # AC2: one user message persisted, one model execution reservation, one
    # quota-charging settlement, and one committed assistant result.
    assert len(harness.session.persists) == 1
    assert len(harness.execution.kinds) == 1
    assert len([c for c in harness.settlement.calls if c.settle_quota]) == 1
    assert len(harness.store.dispatch_calls) == 1
    assert len(harness.store.settle_calls) == 1


class _CommittedResponseExecution:
    # TurnExecution port that commits a typed wire payload (the dict the DB
    # JSONB column would store) and counts real executions (model work).

    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload
        self.executions = 0

    async def execute(
        self,
        kind: object,
        *,
        context: dict[str, object] | None,
        history: object,
        model: object | None,
        on_step: object | None,
    ) -> ExecutionResult:
        del kind, context, history, model, on_step
        self.executions += 1
        return ExecutionResult(
            output=self.payload,
            context_delta={},
            intent="search_bangumi",
            status="ok",
        )


def _agent_with(harness: Harness, execution: TurnExecution) -> AgentTurn:
    return AgentTurn(
        outcome=harness.outcome,
        session=harness.session,
        settlement=harness.settlement,
        execution=execution,
        detect_injection=lambda text: "ignore all" in text,
        guard_enabled=lambda: True,
        blocked_outcome=lambda _snapshot, _locale: "blocked-out",
        extract_delta=lambda _output: {"session_state_v2": {}},
        timeout=30.0,
    )


async def test_replay_reconstructs_the_committed_typed_response_without_reexecuting() -> (
    None
):
    """AC3: the committed wire response (dict payload) is recovered on a
    commit-before-response-loss replay and rebuilds the typed PublicAPIResponse
    — the model execution runs exactly once across the whole exchange."""
    harness = Harness(FakeTurnReservationStore())
    committed = PublicAPIResponse(
        success=True,
        status="ok",
        intent="search_bangumi",
        message="見つかりました。",
        data={"results": {"rows": [], "row_count": 0, "status": "ok"}},
    ).model_dump(mode="json")
    execution = _CommittedResponseExecution(committed)
    agent = _agent_with(harness, execution)

    first = await agent(_input(session_id="s-ac3"))
    assert first.outcome == "completed"
    assert execution.executions == 1

    # Commit-before-response-loss: the same key arrives again; the committed
    # payload is recovered and rebuilds the wire response, never re-executing.
    second = await agent(_input(session_id="s-ac3"))
    assert second.outcome == "replayed"
    assert execution.executions == 1, "replay must not re-run the execution"
    assert second.output == committed
    assert PublicAPIResponse.model_validate(
        second.output
    ) == PublicAPIResponse.model_validate(committed)
