"""Identity adoption for the Session repository (#994).

``_SessionAdoptionMixin`` adopts every anon-owned Session to a signed-in
user and bumps each session's revision so pre-adoption capabilities go
stale. Split out of ``session.py`` (1-10-50).
"""

from __future__ import annotations

from sqlalchemy import func, literal, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from animichi.application.adopt_sessions import (
    ADOPT_TURN_KEY_PREFIX,
    AdoptionResult,
)
from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.models import reservation_table, session_table


class _SessionAdoptionMixin:
    """Private adoption + revision-bump helpers shared by the session store."""

    _sessionmaker: AsyncSessionFactory

    async def adopt_ownership(
        self, from_anon_id: str, to_user_id: str
    ) -> AdoptionResult:
        """Adopt every anonymous-owned Session and bump its revision so
        pre-adoption capabilities go stale (one identity-dimensional UPDATE,
        transactional with the bumps, idempotent on a second run)."""
        async with self._sessionmaker() as session:
            async with session.begin():
                adopted = (
                    (
                        await session.execute(
                            session_table.update()
                            .where(session_table.c.user_id == from_anon_id)
                            .values(user_id=to_user_id, updated_at=func.now())
                            .returning(session_table.c.id)
                        )
                    )
                    .scalars()
                    .all()
                )
                bumped = 0
                for adopted_session_id in adopted:
                    bumped += int(
                        await self._bump_revision(session, str(adopted_session_id))
                    )
                return AdoptionResult(
                    adopted_count=len(adopted), revisions_bumped=bumped
                )

    async def _bump_revision(
        self, session: AsyncSession, adopted_session_id: str
    ) -> int:
        """Advance one adopted session's revision; 1 when the marker landed.

        Mirrors the legacy ``INSERT ... SELECT`` exactly: the marker is only
        written when the session already has a reservation row, uses the
        synthetic ``adopt:`` turn_key namespace with the fixed ``anon`` payer,
        and is a no-op on a concurrent revision race.
        """
        source = select(
            literal(adopted_session_id),
            literal(ADOPT_TURN_KEY_PREFIX + adopted_session_id),
            literal("anon"),
            literal(None),
            func.coalesce(func.max(reservation_table.c.revision), 0) + 1,
            literal(None),
            literal("completed"),
        ).where(reservation_table.c.session_id == adopted_session_id)
        statement = (
            pg_insert(reservation_table)
            .from_select(
                [
                    "session_id",
                    "turn_key",
                    "payer",
                    "identity_id",
                    "revision",
                    "digest",
                    "status",
                ],
                source,
            )
            .on_conflict_do_nothing(constraint="turn_reservations_session_revision")
            .returning(reservation_table.c.session_id)
        )
        result = await session.execute(statement)
        return 1 if result.scalar_one_or_none() is not None else 0


__all__ = ["_SessionAdoptionMixin"]
