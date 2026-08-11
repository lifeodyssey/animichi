"""Reserve/replay branches of PostgresTurnReservationStore (TURN-2/3 #949/#951).

The Neon integration suite covers the live adapter; these hermetic tests pin
the atomic reserve path: insert-with-lease + prune, replay/turn-failed/
in-flight outcome mapping, the raced-winner fallback, and the state digest.
The dispatch/settle/release/sweep lifecycle lives in
``test_turn_reservation_lifecycle``; fakes live in ``turn_reservation_fakes``.
"""

from __future__ import annotations

import asyncio

from animichi.infrastructure.turn_reservation import postgres as pg
from animichi.infrastructure.turn_reservation.postgres import state_digest
from animichi.tests.unit.turn_reservation_fakes import NOW, _request, _store


def test_reserve_inserts_with_lease_and_prunes() -> None:
    store, connection = _store({pg._INSERT_SQL: [{"revision": 1}]})
    outcome = asyncio.run(store.reserve(_request()))
    assert outcome.status == "admitted"
    assert outcome.revision == 1
    assert outcome.owner == _request().owner
    assert any(pg._PRUNE_SQL in sql for sql, _ in connection.executed)


def test_existing_completed_surfaces_replay() -> None:
    store, connection = _store(
        {pg._EXISTING_SQL: [{"status": "completed", "revision": 4}]}
    )
    outcome = asyncio.run(store.reserve(_request()))
    assert outcome.status == "replay_completed"
    assert outcome.revision == 4
    assert connection.executed == []


def test_existing_failed_surfaces_turn_failed() -> None:
    store, _ = _store({pg._EXISTING_SQL: [{"status": "failed", "revision": 3}]})
    outcome = asyncio.run(store.reserve(_request()))
    assert outcome.status == "turn_failed"


def test_existing_active_reservation_surfaces_in_flight() -> None:
    store, _ = _store({pg._EXISTING_SQL: [{"status": "running", "revision": 2}]})
    outcome = asyncio.run(store.reserve(_request()))
    assert outcome.status == "in_flight"


def test_raced_failed_after_insert_conflict() -> None:
    store, _ = _store(
        {
            pg._INSERT_SQL: [None],
            pg._EXISTING_SQL: [None, {"status": "failed", "revision": 2}],
        }
    )
    outcome = asyncio.run(store.reserve(_request()))
    assert outcome.status == "turn_failed"


def test_state_digest_defaults_to_str_render() -> None:
    assert len(state_digest({"when": NOW})) == 64
    assert len(state_digest('{"a": 1}')) == 64
    assert len(state_digest(None)) == 64
    assert isinstance(state_digest(None), str)
    assert state_digest("not-json") != ""


def test_cross_session_owner_is_rejected() -> None:
    store, _ = _store({pg._SESSION_OWNER_SQL: [{"user_id": "other-user"}]})
    outcome = asyncio.run(store.reserve(_request(identity_id="me")))
    assert outcome.status == "ownership"


def test_expected_revision_mismatch_surfaces_stale_revision() -> None:
    store, _ = _store({pg._CURRENT_REVISION_SQL: [{"revision": 2}]})
    outcome = asyncio.run(store.reserve(_request(expected_revision=3)))
    assert outcome.status == "stale_revision"


def test_session_digest_mismatch_surfaces_digest_mismatch() -> None:
    store, _ = _store({pg._SESSION_STATE_SQL: [{"state": "prior-state"}]})
    outcome = asyncio.run(store.reserve(_request(session_digest="digest-x")))
    assert outcome.status == "digest_mismatch"
