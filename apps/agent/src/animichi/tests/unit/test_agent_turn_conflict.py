"""AgentTurn replay conflict rejection (TURN-4 #955, AC4).

A replay is only a safe idempotent retry when the caller re-sends the exact
committed request digest. Admission fails closed: a changed digest — or a
client that omits it entirely — is a typed `request_conflict` refusal, never a
silent replay of an unprovable request.
"""

from __future__ import annotations

from animichi.application.turn_types import TextTurn
from animichi.tests.unit.agent_turn_fakes import Harness, _input
from animichi.tests.unit.turn_admission_fakes import FakeTurnReservationStore


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


async def test_replay_with_a_missing_client_digest_fails_closed_as_conflict() -> None:
    """Fail closed (AC4): a replay is only a safe idempotent retry when the
    caller re-sends the exact committed request digest. A client that omits
    the digest cannot prove it, so admission refuses with a typed conflict
    instead of silently replaying an unknown request."""
    harness = Harness(FakeTurnReservationStore())

    first = await harness.agent(_input(request_digest="digest-a"))
    assert first.outcome == "completed"
    harness.store.dispatch_calls.clear()
    harness.store.settle_calls.clear()

    result = await harness.agent(_input(request_digest=None))

    assert result.outcome == "rejected"
    assert result.rejection is not None
    assert result.rejection.reason == "request_conflict"
    assert harness.store.dispatch_calls == []
    assert harness.store.settle_calls == []
