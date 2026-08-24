"""SQLModel anon-quota counter repository (#995).

Replaces the asyncpg ``AnonQuotaRepository`` on the migrated persistence
seam: same atomic upsert-and-increment semantics against
``anon_daily_message_count``, expressed with SQLModel/SQLAlchemy statements.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.dml import ReturningInsert
from sqlalchemy.sql.selectable import Select

from animichi.infrastructure.persistence.database import AsyncSessionFactory, read_only
from animichi.infrastructure.persistence.models import anon_quota_table


def _count_select(usage_date: date, anon_id: str) -> Select:
    "The message-count read for a (day, identity)."
    return select(anon_quota_table.c.message_count).where(
        anon_quota_table.c.usage_date == usage_date,
        anon_quota_table.c.anon_id == anon_id,
    )


def _increment_statement(usage_date: date, anon_id: str) -> ReturningInsert:
    "Atomic upsert that increments the counter and returns the new value."
    return (
        pg_insert(anon_quota_table)
        .values(**_increment_values(usage_date, anon_id))
        .on_conflict_do_update(
            index_elements=[anon_quota_table.c.usage_date, anon_quota_table.c.anon_id],
            set_=_increment_set(),
        )
        .returning(anon_quota_table.c.message_count)
    )


def _increment_values(usage_date: date, anon_id: str) -> dict[str, object]:
    "The insert columns of one reserved quota count."
    return {
        "usage_date": usage_date,
        "anon_id": anon_id,
        "message_count": 1,
    }


def _increment_set() -> dict[str, object]:
    "The conflict-patch columns for one quota increment."
    return {
        "message_count": anon_quota_table.c.message_count + 1,
        "updated_at": func.now(),
    }


class SQLModelAnonQuotaRepository:
    """Per-identity anonymous daily message counter (issue #282 / S1.10)."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker

    async def count_for(self, *, usage_date: date, anon_id: str) -> int:
        """The admission-gate read; never mutates."""
        async with read_only(self._sessionmaker) as session:
            raw = (
                await session.execute(_count_select(usage_date, anon_id))
            ).scalar_one_or_none()
        return int(raw) if raw is not None else 0

    async def increment_and_count(self, *, usage_date: date, anon_id: str) -> int:
        """Exactly-once settlement write: one row per (day, identity) whose
        counter increments atomically on conflict."""
        async with self._sessionmaker() as session:
            async with session.begin():
                raw = (
                    await session.execute(_increment_statement(usage_date, anon_id))
                ).scalar_one_or_none()
        return int(raw) if raw is not None else 0

    async def increment_and_count_on(
        self, session: AsyncSession, *, usage_date: date, anon_id: str
    ) -> int:
        """Increment the (day, identity) counter on a caller-owned transaction."""
        raw = (
            await session.execute(_increment_statement(usage_date, anon_id))
        ).scalar_one_or_none()
        return int(raw) if raw is not None else 0
