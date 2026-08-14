"""PostgreSQL-backed turn lifecycle on SQLModel/SQLAlchemy expressions (#994).

One atomic ``reserve`` per admission (ownership, revision, digest, durable
single-winner insert, replay/in-flight detection, and the granted lease), plus
the lease-guarded lifecycle the caller immediately drives: ``dispatch``
(reserved -> running), ``settle`` (running -> terminal, exactly-once CAS),
``release``, and the bounded ``sweep`` reclaiming expired leases concurrently.

This adapter replaces the asyncpg ``PostgresTurnReservationStore`` on the
migrated path; every statement is expressed through typed SQLAlchemy
expressions — no raw SQL text exists in this module (enforced by the
repository raw-SQL policy, #999).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

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
from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.models import (
    reservation_table,
    session_table,
)

_RESERVED = "reserved"
_RUNNING = "running"
_FAILED = "failed"
_SWEEP_STATUSES = ("reserved", "running")

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


class SQLModelTurnReservationStore:
    """Production adapter: one lease-guarded turn lifecycle per admission."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome:
        if request.turn_key.startswith(ADOPT_TURN_KEY_PREFIX):
            # Defense in depth: the admission use case already rejects this
            # namespace, but the store must never surface a synthetic marker as
            # a client's `replay_completed` (SESSION-2 #960).
            return ReservationOutcome(status="in_flight", session_id=request.session_id)
        async with self._sessionmaker() as session:
            async with session.begin():
                return await self._reserve(session, request)

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        async with self._sessionmaker() as session:
            async with session.begin():
                result = await session.execute(
                    update(reservation_table)
                    .where(
                        reservation_table.c.session_id.is_not_distinct_from(
                            ref.session_id
                        )
                    )
                    .where(reservation_table.c.turn_key == ref.turn_key)
                    .where(reservation_table.c.status == _RESERVED)
                    .where(reservation_table.c.lease_owner == owner)
                    .where(reservation_table.c.lease_expires_at > func.now())
                    .values(status=_RUNNING, updated_at=func.now())
                    .returning(reservation_table.c.id)
                )
                return result.scalar_one_or_none() is not None

    async def settle(self, ref: TurnRef, *, owner: str, outcome: SettleOutcome) -> bool:
        async with self._sessionmaker() as session:
            async with session.begin():
                result = await session.execute(
                    update(reservation_table)
                    .where(
                        reservation_table.c.session_id.is_not_distinct_from(
                            ref.session_id
                        )
                    )
                    .where(reservation_table.c.turn_key == ref.turn_key)
                    .where(reservation_table.c.status == _RUNNING)
                    .where(reservation_table.c.lease_owner == owner)
                    .where(reservation_table.c.lease_expires_at > func.now())
                    .values(status=outcome, updated_at=func.now())
                    .returning(reservation_table.c.id)
                )
                return result.scalar_one_or_none() is not None

    async def current_revision(self, session_id: str | None) -> int:
        """Return the session's current revision (the max ever reserved).

        ``None`` session ids (unreserved) read as ``0``; the value is
        monotonic because reservation revisions never decrease, so it is a
        valid client CAS token (SESSION-1 #959 GetSessionHistory).
        """
        async with self._sessionmaker() as session:
            return await self._current_revision(session, session_id)

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        async with self._sessionmaker() as session:
            async with session.begin():
                result = await session.execute(
                    delete(reservation_table)
                    .where(
                        reservation_table.c.session_id.is_not_distinct_from(
                            ref.session_id
                        )
                    )
                    .where(reservation_table.c.turn_key == ref.turn_key)
                    .where(reservation_table.c.status == _RESERVED)
                    .where(reservation_table.c.lease_owner == owner)
                    .returning(reservation_table.c.id)
                )
                return result.scalar_one_or_none() is not None

    async def sweep(
        self, *, now: datetime, owner: str, batch_size: int, lease_seconds: int
    ) -> SweepReport:
        """Reclaim expired leases in one bounded, concurrent-safe pass."""
        async with self._sessionmaker() as session:
            async with session.begin():
                return await self._sweep(session, now, owner, batch_size, lease_seconds)

    async def _reserve(
        self, session: AsyncSession, request: ReserveRequest
    ) -> ReservationOutcome:
        guarded = await self._guarded(session, request)
        if guarded is not None:
            return guarded
        revision = (await self._current_revision(session, request.session_id)) + 1
        session_id = request.session_id
        inserted = await session.execute(
            pg_insert(reservation_table)
            .values(
                session_id=session_id,
                turn_key=request.turn_key,
                payer=request.payer,
                identity_id=request.identity_id,
                revision=revision,
                digest=request.session_digest,
                status=_RESERVED,
                lease_owner=request.owner,
                lease_expires_at=request.lease_expires_at,
            )
            .on_conflict_do_nothing()
            .returning(reservation_table.c.revision)
        )
        if inserted.scalar_one_or_none() is not None:
            await self._prune(session, session_id)
            return ReservationOutcome(
                status="admitted",
                session_id=session_id,
                revision=revision,
                owner=request.owner,
                lease_expires_at=request.lease_expires_at,
            )
        raced = await self._existing(session, session_id, request.turn_key)
        if raced is not None:
            return raced
        return ReservationOutcome(status="in_flight", session_id=session_id)

    async def _guarded(
        self, session: AsyncSession, request: ReserveRequest
    ) -> ReservationOutcome | None:
        session_id = request.session_id
        if session_id is not None and not await self._ownership_ok(
            session, session_id, request.identity_id
        ):
            return ReservationOutcome(status="ownership", session_id=session_id)
        existing = await self._existing(session, session_id, request.turn_key)
        if existing is not None:
            return existing
        current = await self._current_revision(session, session_id)
        if (
            request.expected_revision is not None
            and request.expected_revision != current
        ):
            return ReservationOutcome(status="stale_revision", session_id=session_id)
        if session_id is not None and request.session_digest is not None:
            stored = await self._session_state(session, session_id)
            if stored is not None and state_digest(stored) != request.session_digest:
                return ReservationOutcome(
                    status="digest_mismatch", session_id=session_id
                )
        return None

    async def _ownership_ok(
        self, session: AsyncSession, session_id: str, identity_id: str | None
    ) -> bool:
        result = await session.execute(
            select(session_table.c.user_id).where(session_table.c.id == session_id)
        )
        owner = result.scalar_one_or_none()
        if owner is None:
            return True
        return identity_id is not None and str(owner) == identity_id

    async def _session_state(
        self, session: AsyncSession, session_id: str
    ) -> object | None:
        result = await session.execute(
            select(session_table.c.state).where(session_table.c.id == session_id)
        )
        return result.scalar_one_or_none()

    async def _existing(
        self, session: AsyncSession, session_id: str | None, turn_key: str
    ) -> ReservationOutcome | None:
        result = await session.execute(
            select(
                reservation_table.c.status,
                reservation_table.c.revision,
            ).where(
                reservation_table.c.session_id.is_not_distinct_from(session_id),
                reservation_table.c.turn_key == turn_key,
            )
        )
        row = result.first()
        if row is None:
            return None
        status, revision = row
        return ReservationOutcome(
            status=_port_status(str(status)),
            session_id=session_id,
            revision=int(revision),
        )

    async def _current_revision(
        self, session: AsyncSession, session_id: str | None
    ) -> int:
        result = await session.execute(
            select(func.coalesce(func.max(reservation_table.c.revision), 0)).where(
                reservation_table.c.session_id.is_not_distinct_from(session_id)
            )
        )
        return int(result.scalar_one())

    async def _prune(self, session: AsyncSession, session_id: str | None) -> None:
        """Replay-history pruning keeps the `_KEEP_REVISIONS` most recent
        COMPLETED client turns. Synthetic adoption marker rows (``adopt:``
        turn_key namespace) are excluded on both sides — they never consume a
        replay slot and are never pruned (SESSION-2 #960)."""
        keep = (
            select(reservation_table.c.id)
            .where(
                reservation_table.c.session_id.is_not_distinct_from(session_id),
                reservation_table.c.status == "completed",
                ~reservation_table.c.turn_key.like("adopt:%"),
            )
            .order_by(reservation_table.c.revision.desc())
            .limit(_KEEP_REVISIONS)
        )
        await session.execute(
            delete(reservation_table).where(
                reservation_table.c.session_id.is_not_distinct_from(session_id),
                reservation_table.c.status == "completed",
                ~reservation_table.c.turn_key.like("adopt:%"),
                reservation_table.c.id.not_in(keep),
            )
        )

    async def _sweep(
        self,
        session: AsyncSession,
        now: datetime,
        owner: str,
        batch_size: int,
        lease_seconds: int,
    ) -> SweepReport:
        """Claim stale rows atomically with a skip-locked select, re-extending
        the lease per claim."""
        rows = (
            await session.execute(
                select(
                    reservation_table.c.id,
                    reservation_table.c.status,
                )
                .where(reservation_table.c.status.in_(_SWEEP_STATUSES))
                .where(reservation_table.c.lease_expires_at < now)
                .order_by(reservation_table.c.lease_expires_at)
                .limit(batch_size)
                .with_for_update(skip_locked=True)
            )
        ).all()
        claimed = [(row[0], str(row[1])) for row in rows]
        if not claimed:
            return SweepReport()
        await self._claim(session, claimed, owner, now, lease_seconds)
        released = 0
        for rid, status in claimed:
            released += int(await self._claim_row(session, rid, status))
        return SweepReport(released=released, failed=len(claimed) - released)

    async def _claim(
        self,
        session: AsyncSession,
        claimed: Sequence[tuple[object, str]],
        owner: str,
        now: datetime,
        lease_seconds: int,
    ) -> None:
        ids = [rid for rid, _status in claimed]
        await session.execute(
            update(reservation_table)
            .where(reservation_table.c.id.in_(ids))
            .values(
                lease_owner=owner,
                lease_expires_at=now + timedelta(seconds=lease_seconds),
                updated_at=func.now(),
            )
        )

    async def _claim_row(self, session: AsyncSession, rid: object, status: str) -> bool:
        """Settle one claimed row; ``True`` when it was released."""
        released = status == _RESERVED
        if released:
            await session.execute(
                delete(reservation_table).where(reservation_table.c.id == rid)
            )
        else:
            await session.execute(
                update(reservation_table)
                .where(reservation_table.c.id == rid)
                .values(status=_FAILED, updated_at=func.now())
            )
        return released


__all__ = ["SQLModelTurnReservationStore", "state_digest"]
