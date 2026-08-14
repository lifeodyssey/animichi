"""Identity adoption for the Session repository (#994).

Adopts every anon-owned Session to a signed-in user and bumps each
session's revision so pre-adoption capabilities go stale. Split out of
``session.py`` (1-10-50).
"""

from __future__ import annotations

from sqlalchemy import func, literal, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.dml import ReturningInsert
from sqlalchemy.sql.selectable import Select

from animichi.application.adopt_sessions import (
    ADOPT_TURN_KEY_PREFIX,
    AdoptionResult,
)
from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.models import reservation_table, session_table


def _bump_source(adopted_session_id: str) -> Select:
    return select(
        literal(adopted_session_id),
        literal(ADOPT_TURN_KEY_PREFIX + adopted_session_id),
        literal("anon"),
        literal(None),
        func.coalesce(func.max(reservation_table.c.revision), 0) + 1,
        literal(None),
        literal("completed"),
    ).where(reservation_table.c.session_id == adopted_session_id)


#: The column order of the adoption revision-bump ``INSERT ... SELECT``.
_BUMP_COLUMNS = [
    "session_id",
    "turn_key",
    "payer",
    "identity_id",
    "revision",
    "digest",
    "status",
]


def _bump_statement(adopted_session_id: str) -> ReturningInsert:
    return (
        pg_insert(reservation_table)
        .from_select(_BUMP_COLUMNS, _bump_source(adopted_session_id))
        .on_conflict_do_nothing(constraint="turn_reservations_session_revision")
        .returning(reservation_table.c.session_id)
    )


async def _bump_revision(session: AsyncSession, adopted_session_id: str) -> int:
    """Mirror the legacy ``INSERT ... SELECT`` exactly; 1 on insertion."""
    result = await session.execute(_bump_statement(adopted_session_id))
    return 1 if result.scalar_one_or_none() is not None else 0


async def _adopt_rows(
    session: AsyncSession, from_anon_id: str, to_user_id: str
) -> list[object]:
    result = await session.execute(
        session_table.update()
        .where(session_table.c.user_id == from_anon_id)
        .values(user_id=to_user_id, updated_at=func.now())
        .returning(session_table.c.id)
    )
    return list(result.scalars())


class _SessionAdoptionMixin:
    """Private adoption + revision-bump helpers shared by the session store."""

    _sessionmaker: AsyncSessionFactory

    async def adopt_ownership(
        self, from_anon_id: str, to_user_id: str
    ) -> AdoptionResult:
        async with self._sessionmaker() as session:
            async with session.begin():
                adopted = await _adopt_rows(session, from_anon_id, to_user_id)
                bumped = await self._bump_all(session, adopted)
                return AdoptionResult(
                    adopted_count=len(adopted),
                    revisions_bumped=bumped,
                )

    async def _bump_all(
        self,
        session: AsyncSession,
        adopted: list[object],
    ) -> int:
        bumped = 0
        for adopted_session_id in adopted:
            bumped += int(await _bump_revision(session, str(adopted_session_id)))
        return bumped


__all__ = ["_SessionAdoptionMixin"]
