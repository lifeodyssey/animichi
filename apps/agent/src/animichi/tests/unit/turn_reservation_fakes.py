"""Fake asyncpg pool/connection for the PostgresTurnReservationStore tests.

``fetchrow``/``fetch`` pop per-SQL result queues so the same statement can
answer differently across calls; ``fetch`` models the sweep's SQL ``LIMIT``
batch bound.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from animichi.application.identity import UsageScope
from animichi.application.turn_admission_port import ReserveRequest
from animichi.application.turn_outcome_port import TurnRef
from animichi.infrastructure.turn_reservation import postgres as pg
from animichi.infrastructure.turn_reservation.postgres import (
    PostgresTurnReservationStore,
)

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
OWNER = "owner-1"

Row = dict[str, object] | None


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
    def __init__(self, routes: dict[str, Sequence[Row]]) -> None:
        self._routes = {sql: list(rows) for sql, rows in routes.items()}
        self.executed: list[tuple[str, tuple[object, ...]]] = []

    def transaction(self) -> _Transaction:
        return _Transaction()

    async def fetchrow(self, sql: str, *args: object) -> Row:
        return _pop(self._routes, sql)

    async def fetch(self, sql: str, *args: object) -> list[Row]:
        rows = self._routes.get(sql)
        if not rows:
            return []
        limit = _batch_limit(sql, args, len(rows))
        return [rows.pop(0) for _ in range(limit)]

    async def execute(self, sql: str, *args: object) -> None:
        self.executed.append((sql, args))


class _FakePool:
    def __init__(self, connection: _FakeConnection) -> None:
        self._connection = connection

    def acquire(self) -> _Acquired:
        return _Acquired(self._connection)

    async def fetchrow(self, sql: str, *args: object) -> Row:
        return _pop(self._connection._routes, sql)


def _pop(routes: dict[str, list[Row]], sql: str) -> Row:
    queue = routes.get(sql)
    if not queue:
        return None
    return queue.pop(0)


def _batch_limit(sql: str, args: tuple[object, ...], size: int) -> int:
    """Model the sweep's ``LIMIT $2`` batch bound for the claim query."""
    if sql == pg._SWEEP_CLAIM_SQL and len(args) >= 2:
        batch = args[1]
        if isinstance(batch, int):
            return min(batch, size)
    return size


def _request(
    *,
    identity_id: str | None = None,
    turn_key: str = "turn-1",
    session_id: str | None = "s-1",
    expected_revision: int | None = None,
    session_digest: str | None = None,
    payer: UsageScope = "anon",
    owner: str = OWNER,
    lease_expires_at: datetime = NOW + timedelta(seconds=300),
) -> ReserveRequest:
    return ReserveRequest(
        identity_id=identity_id,
        turn_key=turn_key,
        session_id=session_id,
        expected_revision=expected_revision,
        session_digest=session_digest,
        payer=payer,
        owner=owner,
        lease_expires_at=lease_expires_at,
    )


def _store(
    routes: dict[str, Sequence[Row]],
) -> tuple[PostgresTurnReservationStore, _FakeConnection]:
    connection = _FakeConnection(routes=routes)
    return PostgresTurnReservationStore(_FakePool(connection)), connection


def _ref(session_id: str | None = "s-1", turn_key: str = "turn-1") -> TurnRef:
    return TurnRef(session_id=session_id, turn_key=turn_key)
