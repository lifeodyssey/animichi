"""PostgresTurnReservationStore unit tests against a fake pool (TURN-2/3).

The Neon integration suite covers the live adapter; these hermetic tests pin
the lease-guarded lifecycle branches: reserve-with-lease, the dispatch /
settle / release CAS guards, the bounded concurrent-safe sweep, and the
replay/turn_failed outcome mapping. ``fetchrow``/``fetch`` pop per-SQL result
queues so the same statement can answer differently across calls.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from animichi.application.turn_admission_port import ReserveRequest
from animichi.application.turn_outcome_port import TurnRef
from animichi.infrastructure.turn_reservation import postgres as pg
from animichi.infrastructure.turn_reservation.postgres import (
    PostgresTurnReservationStore,
    state_digest,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
OWNER = "owner-1"


class _Transaction:
    async def __aenter__(self) -> _Transaction:
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _Acquired:
    def __init__(self, connection: _FakeConnection) -> None:
        self._connection = connection

    async def __aenter__(self) -> _FakeConnection:
        return self._connection

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _FakeConnection:
    def __init__(self, routes: dict[str, Sequence[Any]]) -> None:
        self._routes = {sql: list(rows) for sql, rows in routes.items()}
        self.executed: list[tuple[str, tuple[Any, ...]]] = []

    def transaction(self) -> _Transaction:
        return _Transaction()

    async def fetchrow(self, sql: str, *args: object) -> Any:
        return _pop(self._routes, sql)

    async def fetch(self, sql: str, *args: object) -> list[Any]:
        rows = self._routes.get(sql)
        if not rows:
            return []
        # The sweep's batch bound is a SQL LIMIT ($2); model it here.
        limit: int
        if sql == pg._SWEEP_CLAIM_SQL and len(args) >= 2:
            batch = args[1]
            limit = min(int(batch), len(rows)) if isinstance(batch, int) else len(rows)
        else:
            limit = len(rows)
        popped = [rows.pop(0) for _ in range(limit)]
        return popped

    async def execute(self, sql: str, *args: object) -> Any:
        self.executed.append((sql, args))


class _FakePool:
    def __init__(self, connection: _FakeConnection) -> None:
        self._connection = connection

    def acquire(self) -> _Acquired:
        return _Acquired(self._connection)

    async def fetchrow(self, sql: str, *args: object) -> Any:
        return _pop(self._connection._routes, sql)


def _pop(routes: dict[str, list[Any]], sql: str) -> Any:
    queue = routes.get(sql)
    if not queue:
        return None
    return queue.pop(0)


def _request(**overrides: Any) -> ReserveRequest:
    fields: dict[str, Any] = {
        "identity_id": None,
        "turn_key": "turn-1",
        "session_id": "s-1",
        "expected_revision": None,
        "session_digest": None,
        "payer": "anon",
        "owner": OWNER,
        "lease_expires_at": NOW + timedelta(seconds=300),
    }
    fields.update(overrides)
    return ReserveRequest(**fields)


def _store(
    routes: dict[str, Sequence[Any]],
) -> tuple[PostgresTurnReservationStore, _FakeConnection]:
    connection = _FakeConnection(routes=routes)
    return PostgresTurnReservationStore(_FakePool(connection)), connection


def _ref(session_id: str | None = "s-1", turn_key: str = "turn-1") -> TurnRef:
    return TurnRef(session_id=session_id, turn_key=turn_key)


def test_reserve_inserts_with_lease_and_prunes() -> None:
    store, connection = _store({pg._INSERT_SQL: [{"revision": 1}]})
    outcome = asyncio.run(store.reserve(_request()))
    assert outcome.status == "admitted"
    assert outcome.revision == 1
    assert outcome.owner == OWNER
    assert any(pg._PRUNE_SQL in sql for sql, _ in connection.executed)


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
    report = asyncio.run(store.sweep(now=NOW, owner="sweep", batch_size=50))
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
    report = asyncio.run(store.sweep(now=NOW, owner="sweep", batch_size=1))
    assert report.released == 1
    assert report.failed == 0
    executed = [sql for sql, _ in connection.executed]
    assert executed.count(pg._SWEEP_RELEASE_SQL) == 1


def test_sweep_claims_nothing_when_no_rows_match() -> None:
    store, connection = _store({})
    report = asyncio.run(store.sweep(now=NOW, owner="sweep", batch_size=50))
    assert report == pg.SweepReport()
    assert connection.executed == []


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
