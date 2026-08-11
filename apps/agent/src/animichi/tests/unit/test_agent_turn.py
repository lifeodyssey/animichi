"""AgentTurn lifecycle (TURN-4 #955): admission, dispatch, settle, replay.

The use case owns one turn through Session, Catalog, ModelTurnPort, and
TurnOutcome. These tests pin initial/continued turns, replay without
dispatch/quota, and the CAS revision/digest rejections.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import cast

from animichi.application.turn_types import TextTurn
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
