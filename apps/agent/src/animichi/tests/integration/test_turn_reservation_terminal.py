"""Real-Postgres contract: turn-reservation terminal states (TURN-2 #949, AC4).

Proves the terminal lifecycle through ``SQLModelTurnReservationStore``: a
replayed completed turn carries its stored request digest (fail-closed
conflict detection), and a failed turn becomes a non-replayable tombstone.
The admission/concurrency tests live in ``test_turn_reservation_store.py``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from animichi.application.turn_outcome_port import TurnRef
from animichi.infrastructure.persistence.repositories.composite import PersistenceRepos
from animichi.infrastructure.persistence.repositories.turn_reservation import (
    SQLModelTurnReservationStore,
)
from animichi.tests.integration.turn_reservation_fakes import (
    _cleanup,
    _ids,
    _reserve,
)

pytestmark = pytest.mark.integration


async def test_completed_replay_carries_digest_for_fail_closed_conflict(
    repos: PersistenceRepos,
) -> None:
    """AC4: a replayed completed turn surfaces the stored request digest so the
    application layer can fail closed on a client that omits or changes it."""
    session_id, turn_key = _ids("replay")
    owner = uuid4().hex
    store: SQLModelTurnReservationStore = repos.turn_reservation
    try:
        await store.reserve(
            _reserve(
                session_id=session_id,
                turn_key=turn_key,
                owner=owner,
                request_digest="digest-a",
            )
        )
        ref = TurnRef(session_id=session_id, turn_key=turn_key)
        assert await store.dispatch(ref, owner=owner)
        assert await store.settle(
            ref, owner=owner, outcome="completed", outcome_payload={"out": 1}
        )
        replay = await store.reserve(_reserve(session_id=session_id, turn_key=turn_key))
        assert replay.status == "replay_completed"
        assert replay.request_digest == "digest-a"
        assert replay.outcome_payload == {"out": 1}
    finally:
        await _cleanup(repos, [session_id])


async def test_failed_turn_is_a_non_replayable_tombstone(
    repos: PersistenceRepos,
) -> None:
    session_id, turn_key = _ids("failed")
    owner = uuid4().hex
    store: SQLModelTurnReservationStore = repos.turn_reservation
    try:
        first = await store.reserve(
            _reserve(
                session_id=session_id,
                turn_key=turn_key,
                owner=owner,
                lease_expires_at=datetime.now(UTC) + timedelta(minutes=1),
            )
        )
        ref = TurnRef(session_id=session_id, turn_key=turn_key)
        assert await store.dispatch(ref, owner=owner)
        assert await store.settle(ref, owner=owner, outcome="failed")
        retry = await store.reserve(_reserve(session_id=session_id, turn_key=turn_key))
        assert retry.status == "turn_failed"
        assert retry.revision == first.revision
    finally:
        await _cleanup(repos, [session_id])
