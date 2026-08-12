"""Postgres-backed :class:`TurnOutcomeStore` (TURN-2 #949, TURN-3 #951).

One atomic ``reserve`` per admission (ownership, revision, digest, durable
single-winner insert, replay/in-flight detection, and the granted lease), plus
the lease-guarded lifecycle the caller immediately drives: ``dispatch``
(reserved -> running), ``settle`` (running -> terminal, exactly-once CAS),
``release``, and the bounded ``sweep`` reclaiming expired leases concurrently.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from datetime import datetime
from typing import TYPE_CHECKING, TypeAlias, cast

import asyncpg

from animichi.application.adopt_sessions import ADOPT_TURN_KEY_PREFIX
from animichi.application.turn_admission_port import (
    AdmissionStatus,
    ReservationOutcome,
    ReserveRequest,
)
from animichi.application.turn_outcome_port import (
    SettleOutcome,
    SweepReport,
    TurnRef,
)

if TYPE_CHECKING:
    AsyncPGPool: TypeAlias = asyncpg.Pool[asyncpg.Record]
else:
    AsyncPGPool = asyncpg.Pool
PoolConnection: TypeAlias = asyncpg.pool.PoolConnectionProxy

_SESSION_STATE_SQL = "SELECT state FROM sessions WHERE id = $1"
#: SESSION-3 (#961): ownership lives on the sole Session aggregate row.
_SESSION_OWNER_SQL = "SELECT user_id FROM sessions WHERE id = $1 LIMIT 1"
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
    INSERT INTO turn_reservations (
        session_id, turn_key, payer, identity_id, revision, digest,
        status, lease_owner, lease_expires_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'reserved', $7, $8)
    ON CONFLICT DO NOTHING
    RETURNING revision
"""
_DISPATCH_SQL = """
    UPDATE turn_reservations
    SET status = 'running', updated_at = now()
    WHERE session_id IS NOT DISTINCT FROM $1 AND turn_key = $2
      AND status = 'reserved' AND lease_owner = $3 AND lease_expires_at > now()
    RETURNING id
"""
_SETTLE_SQL = """
    UPDATE turn_reservations
    SET status = $3, updated_at = now()
    WHERE session_id IS NOT DISTINCT FROM $1 AND turn_key = $2
      AND status = 'running' AND lease_owner = $4 AND lease_expires_at > now()
    RETURNING id
"""
_RELEASE_SQL = """
    DELETE FROM turn_reservations
    WHERE session_id IS NOT DISTINCT FROM $1 AND turn_key = $2
      AND status = 'reserved' AND lease_owner = $3
    RETURNING id
"""
#: Replay-history pruning keeps the `_KEEP_REVISIONS` most recent COMPLETED
#: client turns. Synthetic adoption marker rows (`adopt:` turn_key namespace)
#: are the revision-CAS authority and are EXCLUDED on both sides — they never
#: consume a replay slot and are never pruned (SESSION-2 #960).
_PRUNE_SQL = """
    DELETE FROM turn_reservations
    WHERE session_id IS NOT DISTINCT FROM $1
      AND status = 'completed'
      AND turn_key NOT LIKE 'adopt:%'
      AND id NOT IN (
          SELECT id FROM turn_reservations
          WHERE session_id IS NOT DISTINCT FROM $1
            AND status = 'completed'
            AND turn_key NOT LIKE 'adopt:%'
          ORDER BY revision DESC
          LIMIT $2
      )
"""
#: Claim stale rows atomically (SKIP LOCKED), re-extending the lease per claim.
_SWEEP_CLAIM_SQL = """
    WITH stale AS (
        SELECT id FROM turn_reservations
        WHERE status IN ('reserved', 'running') AND lease_expires_at < $1
        ORDER BY lease_expires_at
        FOR UPDATE SKIP LOCKED
        LIMIT $2
    )
    UPDATE turn_reservations
    SET lease_owner = $3, lease_expires_at = now() + make_interval(secs => $4),
        updated_at = now()
    WHERE id IN (SELECT id FROM stale)
    RETURNING session_id, turn_key, status
"""
_SWEEP_RELEASE_SQL = """
    DELETE FROM turn_reservations
    WHERE session_id IS NOT DISTINCT FROM $1 AND turn_key = $2
      AND lease_owner = $3 AND status = 'reserved'
"""
_SWEEP_FAIL_SQL = """
    UPDATE turn_reservations
    SET status = 'failed', updated_at = now()
    WHERE session_id IS NOT DISTINCT FROM $1 AND turn_key = $2
      AND lease_owner = $3 AND status = 'running'
"""

#: Per-status settlement SQL for one claimed sweep row.
_SWEEP_ACTIONS: dict[str, str] = {
    "reserved": _SWEEP_RELEASE_SQL,
    "running": _SWEEP_FAIL_SQL,
}

#: Per-session reservation history retained for replay (recent turns only).
_KEEP_REVISIONS = 16


def _port_status(stored: str) -> AdmissionStatus:
    """Map a stored row status to the port vocabulary (failed never replays)."""
    if stored == "completed":
        return "replay_completed"
    if stored == "failed":
        return "turn_failed"
    return "in_flight"


def state_digest(state: object) -> str:
    """Canonical sha256 hex digest of a stored session state envelope."""
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
    """Production adapter: one lease-guarded turn lifecycle per admission."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome:
        if request.turn_key.startswith(ADOPT_TURN_KEY_PREFIX):
            # Defense in depth: the admission use case already rejects this
            # namespace, but the store must never surface a synthetic marker as
            # a client's `replay_completed` (SESSION-2 #960).
            return ReservationOutcome(status="in_flight", session_id=request.session_id)
        async with self._pool.acquire() as connection:
            async with connection.transaction():
                return await self._reserve(connection, request)

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        row = await self._pool.fetchrow(
            _DISPATCH_SQL, ref.session_id, ref.turn_key, owner
        )
        return row is not None

    async def settle(self, ref: TurnRef, *, owner: str, outcome: SettleOutcome) -> bool:
        row = await self._pool.fetchrow(
            _SETTLE_SQL, ref.session_id, ref.turn_key, outcome, owner
        )
        return row is not None

    async def current_revision(self, session_id: str) -> int:
        """Return the session's current revision (the max ever reserved).

        ``None`` session ids (unreserved) read as ``0``; the value is
        monotonic because reservation revisions never decrease, so it is a
        valid client CAS token (SESSION-1 #959 GetSessionHistory).
        """
        async with self._pool.acquire() as connection:
            return await self._current_revision(connection, session_id)

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        row = await self._pool.fetchrow(
            _RELEASE_SQL, ref.session_id, ref.turn_key, owner
        )
        return row is not None

    async def sweep(
        self, *, now: datetime, owner: str, batch_size: int, lease_seconds: int
    ) -> SweepReport:
        async with self._pool.acquire() as connection:
            async with connection.transaction():
                return await self._sweep(
                    connection, now, owner, batch_size, lease_seconds
                )

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
            return existing
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
            request.owner,
            request.lease_expires_at,
        )
        if inserted is not None:
            await self._prune(connection, session_id)
            return ReservationOutcome(
                status="admitted",
                session_id=session_id,
                revision=revision,
                owner=request.owner,
                lease_expires_at=request.lease_expires_at,
            )

        raced = await self._existing(connection, session_id, request.turn_key)
        if raced is not None:
            return raced
        return ReservationOutcome(status="in_flight", session_id=session_id)

    async def _sweep(
        self,
        connection: PoolConnection,
        now: datetime,
        owner: str,
        batch_size: int,
        lease_seconds: int,
    ) -> SweepReport:
        """Reclaim expired leases in one bounded, concurrent-safe pass."""
        rows = await connection.fetch(
            _SWEEP_CLAIM_SQL, now, batch_size, owner, lease_seconds
        )
        released = await self._count_released(connection, rows, owner)
        return SweepReport(released=released, failed=len(rows) - released)

    async def _count_released(
        self, connection: PoolConnection, rows: Sequence[asyncpg.Record], owner: str
    ) -> int:
        """How many claimed rows were released (the rest were failed)."""
        released = 0
        for row in rows:
            released += int(await self._claim_row(connection, row, owner))
        return released

    async def _claim_row(
        self, connection: PoolConnection, row: asyncpg.Record, owner: str
    ) -> bool:
        """Settle one claimed row; ``True`` when it was released."""
        sql = _SWEEP_ACTIONS[row["status"]]
        await connection.execute(sql, row["session_id"], row["turn_key"], owner)
        if row["status"] == "reserved":
            return True
        return False

    async def _ownership_ok(
        self, connection: PoolConnection, session_id: str, identity_id: str | None
    ) -> bool:
        owner = await connection.fetchrow(_SESSION_OWNER_SQL, session_id)
        if owner is None:
            return True
        return identity_id is not None and owner["user_id"] == identity_id

    async def _existing(
        self, connection: PoolConnection, session_id: str | None, turn_key: str
    ) -> ReservationOutcome | None:
        row = await connection.fetchrow(_EXISTING_SQL, session_id, turn_key)
        if row is None:
            return None
        return ReservationOutcome(
            status=_port_status(cast(str, row["status"])),
            session_id=session_id,
            revision=cast(int, row["revision"]),
        )

    async def _current_revision(
        self, connection: PoolConnection, session_id: str | None
    ) -> int:
        row = await connection.fetchrow(_CURRENT_REVISION_SQL, session_id)
        return int(row["revision"]) if row is not None else 0

    async def _prune(self, connection: PoolConnection, session_id: str | None) -> None:
        await connection.execute(_PRUNE_SQL, session_id, _KEEP_REVISIONS)
