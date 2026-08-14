"""PostgreSQL-backed turn lifecycle on SQLModel/SQLAlchemy expressions (#994).

One atomic ``reserve`` per admission (ownership, revision, digest, durable
single-winner insert, replay/in-flight detection, and the granted lease), plus
the lease-guarded lifecycle the caller immediately drives: ``dispatch``
(reserved -> running), ``settle`` (running -> terminal, exactly-once CAS),
``release``, and the bounded ``sweep`` reclaiming expired leases concurrently.

This adapter replaces the asyncpg ``PostgresTurnReservationStore`` on the
migrated path; every statement is expressed through typed SQLAlchemy
expressions — no raw SQL text exists in this module (enforced by the
repository raw-SQL policy, #999). Status mapping/digest helpers and the
lease sweep live in ``_turn_digest`` / ``_turn_sweep`` (1-10-50).
"""

from __future__ import annotations

from datetime import datetime

from animichi.application.adopt_sessions import ADOPT_TURN_KEY_PREFIX
from animichi.application.turn_admission_port import (
    ReservationOutcome,
    ReserveRequest,
)
from animichi.application.turn_outcome_port import (
    SettleOutcome,
    SweepReport,
    TurnRef,
)
from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.repositories._turn_admission import (
    _admit,
    _current_revision,
    _dispatch_statement,
    _release_statement,
    _settle_statement,
)
from animichi.infrastructure.persistence.repositories._turn_digest import (
    state_digest,
)
from animichi.infrastructure.persistence.repositories._turn_sweep import _sweep


class SQLModelTurnReservationStore:
    """Production adapter: one lease-guarded turn lifecycle per admission."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome:
        if request.turn_key.startswith(ADOPT_TURN_KEY_PREFIX):
            # Defense in depth: never surface a synthetic marker as a client
            # `replay_completed` (SESSION-2 #960).
            return ReservationOutcome(status="in_flight", session_id=request.session_id)
        async with self._sessionmaker() as session:
            async with session.begin():
                return await _admit(session, request)

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        async with self._sessionmaker() as session:
            async with session.begin():
                result = await session.execute(_dispatch_statement(ref, owner))
                return result.scalar_one_or_none() is not None

    async def settle(
        self,
        ref: TurnRef,
        *,
        owner: str,
        outcome: SettleOutcome,
        outcome_payload: object | None = None,
    ) -> bool:
        async with self._sessionmaker() as session:
            async with session.begin():
                result = await session.execute(
                    _settle_statement(
                        ref, owner, outcome, outcome_payload=outcome_payload
                    )
                )
                return result.scalar_one_or_none() is not None

    async def current_revision(self, session_id: str | None) -> int:
        """Return the session current revision (max ever reserved); ``None``s read as 0."""
        async with self._sessionmaker() as session:
            return await _current_revision(session, session_id)

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        async with self._sessionmaker() as session:
            async with session.begin():
                result = await session.execute(_release_statement(ref, owner))
                return result.scalar_one_or_none() is not None

    async def sweep(
        self, *, now: datetime, owner: str, batch_size: int, lease_seconds: int
    ) -> SweepReport:
        """Reclaim expired leases in one bounded, concurrent-safe pass."""
        async with self._sessionmaker() as session:
            async with session.begin():
                return await _sweep(session, now, owner, batch_size, lease_seconds)


__all__ = ["SQLModelTurnReservationStore", "state_digest"]
