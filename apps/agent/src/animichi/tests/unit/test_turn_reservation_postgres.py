"""PostgresTurnReservationStore unit tests against a fake pool (TURN-2 #949).

The Neon integration suite covers the live adapter; these hermetic tests pin
the SQL-mapping branches (guard ordering, outcome mapping, prune/complete/fail
SQL) without a database. ``fetchrow`` pops a per-SQL result queue so the same
statement can answer differently across calls (e.g. the insert-conflict race).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from animichi.application.turn_admission_port import ReserveRequest
from animichi.infrastructure.turn_reservation import postgres as pg
from animichi.infrastructure.turn_reservation.postgres import (
    PostgresTurnReservationStore,
    state_digest,
)


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
        queue = self._routes.get(sql)
        if not queue:
            return None
        return queue.pop(0)

    async def execute(self, sql: str, *args: object) -> Any:
        self.executed.append((sql, args))


class _FakePool:
    def __init__(self, connection: _FakeConnection) -> None:
        self._connection = connection

    def acquire(self) -> _Acquired:
        return _Acquired(self._connection)

    async def execute(self, sql: str, *args: object) -> None:
        self._connection.executed.append((sql, args))


def _request(**overrides: Any) -> ReserveRequest:
    fields: dict[str, Any] = {
        "identity_id": None,
        "turn_key": "turn-1",
        "session_id": "s-1",
        "expected_revision": None,
        "session_digest": None,
        "payer": "anon",
    }
    fields.update(overrides)
    return ReserveRequest(**fields)


def _run(store: PostgresTurnReservationStore, request: ReserveRequest) -> Any:
    import asyncio

    return asyncio.run(store.reserve(request))


def _store(
    routes: dict[str, Sequence[Any]],
) -> tuple[PostgresTurnReservationStore, _FakeConnection]:
    connection = _FakeConnection(routes=routes)
    return PostgresTurnReservationStore(_FakePool(connection)), connection


def test_admitted_path_inserts_and_prunes() -> None:
    store, connection = _store({pg._INSERT_SQL: [{"revision": 1}]})
    outcome = _run(store, _request())
    assert outcome.status == "admitted"
    assert outcome.revision == 1
    assert any(pg._PRUNE_SQL in sql for sql, _ in connection.executed)


def test_ownership_rejected_before_any_insert() -> None:
    store, _ = _store({pg._SESSION_OWNER_SQL: [{"user_id": "user-a"}]})
    outcome = _run(store, _request(identity_id="user-b"))
    assert outcome.status == "ownership"


def test_ownership_mismatch_with_nullable_session_passes() -> None:
    store, connection = _store({pg._INSERT_SQL: [{"revision": 1}]})
    outcome = _run(store, _request(identity_id="user-b", session_id=None))
    assert outcome.status == "admitted"
    assert pg._PRUNE_SQL in connection.executed[0][0]


def test_existing_in_flight_replays_without_insert() -> None:
    store, connection = _store(
        {pg._EXISTING_SQL: [{"status": "in_flight", "revision": 2}]}
    )
    outcome = _run(store, _request())
    assert outcome.status == "in_flight"
    assert outcome.revision == 2
    assert connection.executed == []


def test_existing_completed_surfaces_replay() -> None:
    store, connection = _store(
        {pg._EXISTING_SQL: [{"status": "completed", "revision": 4}]}
    )
    outcome = _run(store, _request())
    assert outcome.status == "replay_completed"
    assert connection.executed == []


def test_stale_revision_rejects() -> None:
    store, _ = _store({pg._CURRENT_REVISION_SQL: [{"revision": 2}]})
    outcome = _run(store, _request(expected_revision=1))
    assert outcome.status == "stale_revision"


def test_digest_mismatch_rejects() -> None:
    store, _ = _store({pg._SESSION_STATE_SQL: [{"state": '{"a": 1}'}]})
    outcome = _run(store, _request(session_digest="other"))
    assert outcome.status == "digest_mismatch"


def test_missing_session_state_passes_digest() -> None:
    store, connection = _store({pg._INSERT_SQL: [{"revision": 1}]})
    outcome = _run(store, _request(session_digest="any"))
    assert outcome.status == "admitted"
    assert pg._PRUNE_SQL in connection.executed[0][0]


def test_raced_completed_after_insert_conflict() -> None:
    store, _ = _store(
        {
            pg._INSERT_SQL: [None],
            pg._EXISTING_SQL: [None, {"status": "completed", "revision": 3}],
        }
    )
    outcome = _run(store, _request())
    assert outcome.status == "replay_completed"
    assert outcome.revision == 3


def test_raced_in_flight_after_insert_conflict() -> None:
    store, _ = _store(
        {
            pg._INSERT_SQL: [None],
            pg._EXISTING_SQL: [None, {"status": "in_flight", "revision": 2}],
        }
    )
    outcome = _run(store, _request())
    assert outcome.status == "in_flight"


def test_complete_issues_the_update() -> None:
    store, connection = _store({})
    import asyncio

    asyncio.run(store.complete(session_id="s-1", turn_key="turn-1"))
    assert any(pg._COMPLETE_SQL in sql for sql, _ in connection.executed)


def test_fail_issues_the_delete() -> None:
    store, connection = _store({})
    import asyncio

    asyncio.run(store.fail(session_id="s-1", turn_key="turn-1"))
    assert any(pg._RELEASE_SQL in sql for sql, _ in connection.executed)


def test_state_digest_canonicalises_json_text() -> None:
    assert state_digest('{"b": 1, "a": 2}') == state_digest({"a": 2, "b": 1})


def test_state_digest_invalid_json_digests_as_empty() -> None:
    assert state_digest("not-json") == state_digest({})


def test_state_digest_non_dict_digests_as_empty() -> None:
    assert state_digest([1, 2]) == state_digest({})


def test_state_digest_defaults_to_str_render() -> None:
    from datetime import datetime

    assert len(state_digest({"when": datetime(2026, 8, 11)})) == 64
