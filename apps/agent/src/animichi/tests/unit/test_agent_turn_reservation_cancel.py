"""A cancel mid-`load`/`dispatch` must still relinquish the reservation.

`CancelledError` is a `BaseException`, not an `Exception`, since Python 3.8:
the reservation-lifecycle awaits in `AgentTurn._load_and_dispatch` used to
sit outside any cancel-aware cleanup, so a client disconnect landing there
left the reservation stuck until its lease expired (up to 300s) instead of
being released immediately.
"""

from __future__ import annotations

import asyncio

import pytest

from animichi.application.agent_turn import AgentTurn
from animichi.application.turn_outcome_port import TurnRef
from animichi.tests.unit.agent_turn_fakes import FakeSession, Harness, _input
from animichi.tests.unit.turn_admission_fakes import FakeTurnReservationStore


class _CancellationResistantSession(FakeSession):
    def __init__(self) -> None:
        super().__init__()
        self.entered = asyncio.Event()

    async def load(self, session_id: str | None, *, user_id: str | None):
        del session_id, user_id
        self.entered.set()
        await asyncio.Future()


class _HangingDispatchStore(FakeTurnReservationStore):
    """Cancels while `dispatch` is still in flight (commit outcome unknown)."""

    def __init__(self) -> None:
        super().__init__()
        self.dispatch_entered = asyncio.Event()

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        self.dispatch_calls.append((ref.session_id, ref.turn_key, owner))
        self.dispatch_entered.set()
        await asyncio.Future()
        return True


class _HangingAfterCommitDispatchStore(FakeTurnReservationStore):
    """Cancels after the reserved->running commit already landed."""

    def __init__(self) -> None:
        super().__init__()
        self.dispatch_committed = asyncio.Event()

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        committed = await super().dispatch(ref, owner=owner)
        self.dispatch_committed.set()
        await asyncio.Future()
        return committed


def _agent(harness: Harness, *, session: FakeSession | None = None) -> AgentTurn:
    return AgentTurn(
        outcome=harness.outcome,
        session=session or harness.session,
        settlement=harness.settlement,
        execution=harness.execution,
        detect_injection=lambda text: "ignore all" in text,
        guard_enabled=lambda: True,
        blocked_outcome=lambda _snapshot, _locale: "blocked-out",
        extract_delta=lambda _output: {"session_state_v2": {}},
        timeout=30.0,
    )


async def test_cancel_during_load_releases_the_reservation_once() -> None:
    harness = Harness(FakeTurnReservationStore())
    session = _CancellationResistantSession()
    harness.agent = _agent(harness, session=session)

    turn = asyncio.create_task(harness.agent(_input(session_id="s-1")))
    await session.entered.wait()
    turn.cancel()
    with pytest.raises(asyncio.CancelledError):
        await turn

    assert harness.store.dispatch_calls == []
    assert len(harness.store.release_calls) == 1
    assert harness.store.release_calls[0][:2] == ("s-1", "turn-1")
    assert harness.store.settle_calls == []


async def test_cancel_during_dispatch_relinquishes_via_release() -> None:
    store = _HangingDispatchStore()
    harness = Harness(store)
    harness.agent = _agent(harness)

    turn = asyncio.create_task(harness.agent(_input(session_id="s-1")))
    await store.dispatch_entered.wait()
    turn.cancel()
    with pytest.raises(asyncio.CancelledError):
        await turn

    assert len(store.dispatch_calls) == 1
    assert len(store.release_calls) == 1
    assert store.settle_calls == []
    assert store.reservations == []


async def test_cancel_after_dispatch_commits_settles_failed_instead() -> None:
    store = _HangingAfterCommitDispatchStore()
    harness = Harness(store)
    harness.agent = _agent(harness)

    turn = asyncio.create_task(harness.agent(_input(session_id="s-1")))
    await store.dispatch_committed.wait()
    turn.cancel()
    with pytest.raises(asyncio.CancelledError):
        await turn

    assert len(store.dispatch_calls) == 1
    assert len(store.release_calls) == 1
    assert store.settle_calls[0][:2] == ("s-1", "turn-1")
    assert store.settle_calls[0][3] == "failed"
    assert store.reservations[0].status == "failed"
