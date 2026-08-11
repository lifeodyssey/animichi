"""Dispatch/settle/release/sweep lifecycle of PostgresTurnReservationStore.

Pins the lease-guarded CAS guards (wrong owner loses, exactly-once settle),
the bounded concurrent-safe sweep, and the no-match no-op (TURN-3 #951).
Reserve/replay branches live in ``test_turn_reservation_postgres``.
"""

from __future__ import annotations

import asyncio

from animichi.infrastructure.turn_reservation import postgres as pg
from animichi.tests.unit.turn_reservation_fakes import (
    NOW,
    OWNER,
    _ref,
    _store,
)


def test_dispatch_transitions_reserved_to_running() -> None:
    store, _ = _store({pg._DISPATCH_SQL: [{"id": 1}]})
    assert asyncio.run(store.dispatch(_ref(), owner=OWNER)) is True


def test_dispatch_loses_on_wrong_owner() -> None:
    store, _ = _store({})
    assert asyncio.run(store.dispatch(_ref(), owner="someone-else")) is False


def test_settle_transitions_running_to_terminal() -> None:
    store, _ = _store({pg._SETTLE_SQL: [{"id": 1}]})
    assert asyncio.run(store.settle(_ref(), owner=OWNER, outcome="completed")) is True


def test_settle_is_exactly_once_after_the_first_win() -> None:
    store, _ = _store({pg._SETTLE_SQL: [{"id": 1}, None]})
    assert asyncio.run(store.settle(_ref(), owner=OWNER, outcome="completed")) is True
    assert asyncio.run(store.settle(_ref(), owner=OWNER, outcome="completed")) is False


def test_settle_fails_for_a_non_owner() -> None:
    store, _ = _store({})
    assert asyncio.run(store.settle(_ref(), owner="other", outcome="failed")) is False


def test_release_deletes_a_reserved_turn() -> None:
    store, _ = _store({pg._RELEASE_SQL: [{"id": 1}]})
    assert asyncio.run(store.release(_ref(), owner=OWNER)) is True


def test_release_loses_when_the_owner_mismatches() -> None:
    store, _ = _store({})
    assert asyncio.run(store.release(_ref(), owner="other")) is False


def test_sweep_releases_stale_reserved_and_fails_stale_running() -> None:
    store, connection = _store(
        {
            pg._SWEEP_CLAIM_SQL: [
                {"session_id": "s-1", "turn_key": "t-1", "status": "reserved"},
                {"session_id": "s-2", "turn_key": "t-2", "status": "running"},
            ]
        }
    )
    report = asyncio.run(
        store.sweep(now=NOW, owner="sweep", batch_size=50, lease_seconds=300)
    )
    assert report.released == 1
    assert report.failed == 1
    assert any(pg._SWEEP_RELEASE_SQL in sql for sql, _ in connection.executed)
    assert any(pg._SWEEP_FAIL_SQL in sql for sql, _ in connection.executed)


def test_sweep_is_bounded_by_the_batch() -> None:
    store, connection = _store(
        {
            pg._SWEEP_CLAIM_SQL: [
                {"session_id": "s-1", "turn_key": "t-1", "status": "reserved"},
                {"session_id": "s-2", "turn_key": "t-2", "status": "reserved"},
            ]
        }
    )
    report = asyncio.run(
        store.sweep(now=NOW, owner="sweep", batch_size=1, lease_seconds=300)
    )
    assert report.released == 1
    assert report.failed == 0
    executed = [sql for sql, _ in connection.executed]
    assert executed.count(pg._SWEEP_RELEASE_SQL) == 1


def test_sweep_claims_nothing_when_no_rows_match() -> None:
    store, connection = _store({})
    report = asyncio.run(
        store.sweep(now=NOW, owner="sweep", batch_size=50, lease_seconds=300)
    )
    assert report == pg.SweepReport()
    assert connection.executed == []
