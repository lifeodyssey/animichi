"""Postgres-backed :class:`TurnReservationStore` (TURN-2 #949).

One atomic ``reserve`` per admission: ownership, revision, digest, the
durable single-winner insert, and replay/in-flight detection all run inside a
single connection transaction against the live ``turn_reservations``,
``sessions`` and ``conversations`` tables.
"""

from __future__ import annotations

import hashlib
import json
from typing import TYPE_CHECKING, TypeAlias, cast

import asyncpg

from animichi.application.turn_admission_port import (
    AdmissionStatus,
    ReservationOutcome,
    ReserveRequest,
)

if TYPE_CHECKING:
    AsyncPGPool: TypeAlias = asyncpg.Pool[asyncpg.Record]
else:
    AsyncPGPool = asyncpg.Pool
PoolConnection: TypeAlias = asyncpg.pool.PoolConnectionProxy

_SESSION_STATE_SQL = "SELECT state FROM sessions WHERE id = $1"
_SESSION_OWNER_SQL = "SELECT user_id FROM conversations WHERE session_id = $1 LIMIT 1"
_CURRENT_REVISION_SQL = """
    SELECT COALESCE(MAX(revision), 0) AS revision
    FROM turn_reservations
    WHERE session_id IS NOT DISTINCT FROM $1
"""
_EXISTING_SQL = """
    SELECT status, revision
    FROM turn_reservations
    WHERE session_id IS NOT DISTINCT FROM $1 AND turn_key = $2
"""
_INSERT_SQL = """
    INSERT INTO turn_reservations (session_id, turn_key, payer, identity_id, revision, digest, status)
    VALUES ($1, $2, $3, $4, $5, $6, 'in_flight')
    ON CONFLICT DO NOTHING
    RETURNING revision
"""
_COMPLETE_SQL = """
    UPDATE turn_reservations
    SET status = 'completed', updated_at = now()
    WHERE session_id IS NOT DISTINCT FROM $1 AND turn_key = $2 AND status = 'in_flight'
"""
_RELEASE_SQL = """
    DELETE FROM turn_reservations
    WHERE session_id IS NOT DISTINCT FROM $1 AND turn_key = $2
"""
_PRUNE_SQL = """
    DELETE FROM turn_reservations
    WHERE session_id IS NOT DISTINCT FROM $1
      AND id NOT IN (
          SELECT id FROM turn_reservations
          WHERE session_id IS NOT DISTINCT FROM $1
          ORDER BY revision DESC
          LIMIT $2
      )
"""

#: Per-session reservation history retained for replay (recent turns only).
_KEEP_REVISIONS = 16


def _port_status(stored: AdmissionStatus) -> AdmissionStatus:
    """Translate the stored row status to the port vocabulary: a completed
    reservation is surfaced as ``replay_completed`` for the admission use case."""
    if stored == "completed":
        return "replay_completed"
    return stored


def state_digest(state: object) -> str:
    """Canonical sha256 hex digest of a stored session state envelope.

    asyncpg surfaces ``jsonb`` columns as raw JSON text, so a string payload
    is parsed before the canonical dump; any other shape digests as empty.
    """
    if isinstance(state, str):
        try:
            state = json.loads(state)
        except json.JSONDecodeError:
            state = {}
    if not isinstance(state, dict):
        state = {}
    payload = json.dumps(state, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class PostgresTurnReservationStore:
    """Production adapter: one durable reservation per admission."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome:
        # Known limit (TURN-2 review): the reservation commits here, while the
        # quota increment and the fail/complete settlement run in separate
        # transactions in the caller. A crash between them leaves an orphaned
        # in_flight row; it is pruned on the session's next insert
        # (_prune) and retried turns self-heal, but an interrupted session
        # with no further activity retains the row until the next insert.
        async with self._pool.acquire() as connection:
            async with connection.transaction():
                return await self._reserve(connection, request)

    async def _guarded(
        self, connection: PoolConnection, request: ReserveRequest
    ) -> ReservationOutcome | None:
        session_id = request.session_id
        if session_id is not None and not await self._ownership_ok(
            connection, session_id, request.identity_id
        ):
            return ReservationOutcome(status="ownership", session_id=session_id)
        existing = await self._existing(connection, session_id, request.turn_key)
        if existing is not None:
            return ReservationOutcome(
                status=_port_status(existing.status),
                session_id=session_id,
                revision=existing.revision,
            )
        current = await self._current_revision(connection, session_id)
        if (
            request.expected_revision is not None
            and request.expected_revision != current
        ):
            return ReservationOutcome(status="stale_revision", session_id=session_id)
        if session_id is not None and request.session_digest is not None:
            state = await connection.fetchrow(_SESSION_STATE_SQL, session_id)
            if (
                state is not None
                and state_digest(state["state"]) != request.session_digest
            ):
                return ReservationOutcome(
                    status="digest_mismatch", session_id=session_id
                )
        return None

    async def _reserve(
        self, connection: PoolConnection, request: ReserveRequest
    ) -> ReservationOutcome:
        guarded = await self._guarded(connection, request)
        if guarded is not None:
            return guarded
        revision = (await self._current_revision(connection, request.session_id)) + 1
        session_id = request.session_id
        inserted = await connection.fetchrow(
            _INSERT_SQL,
            session_id,
            request.turn_key,
            request.payer,
            request.identity_id,
            revision,
            request.session_digest,
        )
        if inserted is not None:
            await self._prune(connection, session_id)
            return ReservationOutcome(
                status="admitted", session_id=session_id, revision=revision
            )

        raced = await self._existing(connection, session_id, request.turn_key)
        if raced is not None and raced.status == "completed":
            return ReservationOutcome(
                status="replay_completed",
                session_id=session_id,
                revision=raced.revision,
            )
        return ReservationOutcome(status="in_flight", session_id=session_id)

    async def complete(self, *, session_id: str | None, turn_key: str) -> None:
        await self._pool.execute(_COMPLETE_SQL, session_id, turn_key)

    async def fail(self, *, session_id: str | None, turn_key: str) -> None:
        await self._pool.execute(_RELEASE_SQL, session_id, turn_key)

    async def _ownership_ok(
        self, connection: PoolConnection, session_id: str, identity_id: str | None
    ) -> bool:
        if identity_id is None:
            return True
        owner = await connection.fetchrow(_SESSION_OWNER_SQL, session_id)
        return owner is None or owner["user_id"] == identity_id

    async def _existing(
        self, connection: PoolConnection, session_id: str | None, turn_key: str
    ) -> ReservationOutcome | None:
        row = await connection.fetchrow(_EXISTING_SQL, session_id, turn_key)
        if row is None:
            return None
        status = cast(AdmissionStatus, row["status"])
        revision = cast(int, row["revision"])
        return ReservationOutcome(
            status=status, session_id=session_id, revision=revision
        )

    async def _current_revision(
        self, connection: PoolConnection, session_id: str | None
    ) -> int:
        row = await connection.fetchrow(_CURRENT_REVISION_SQL, session_id)
        return int(row["revision"]) if row is not None else 0

    async def _prune(self, connection: PoolConnection, session_id: str | None) -> None:
        await connection.execute(_PRUNE_SQL, session_id, _KEEP_REVISIONS)
