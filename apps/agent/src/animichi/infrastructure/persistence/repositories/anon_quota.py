"""SQLModel anon-quota counter repository (#995).

Replaces the asyncpg ``AnonQuotaRepository`` on the migrated persistence
seam: same atomic upsert-and-increment semantics against
``anon_daily_message_count``, expressed with SQLModel/SQLAlchemy statements.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.models import anon_quota_table


class SQLModelAnonQuotaRepository:
    """Per-identity anonymous daily message counter (issue #282 / S1.10)."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker

    async def count_for(self, *, usage_date: date, anon_id: str) -> int:
        """The admission-gate read; never mutates."""
        async with self._sessionmaker() as session:
            raw = (
                await session.execute(
                    select(anon_quota_table.c.message_count).where(
                        anon_quota_table.c.usage_date == usage_date,
                        anon_quota_table.c.anon_id == anon_id,
                    )
                )
            ).scalar_one_or_none()
        return int(raw) if raw is not None else 0

    async def increment_and_count(self, *, usage_date: date, anon_id: str) -> int:
        """Exactly-once settlement write: one row per (day, identity) whose
        counter increments atomically on conflict."""
        async with self._sessionmaker() as session:
            async with session.begin():
                statement = (
                    pg_insert(anon_quota_table)
                    .values(
                        usage_date=usage_date,
                        anon_id=anon_id,
                        message_count=1,
                    )
                    .on_conflict_do_update(
                        index_elements=[
                            anon_quota_table.c.usage_date,
                            anon_quota_table.c.anon_id,
                        ],
                        set_={
                            "message_count": anon_quota_table.c.message_count + 1,
                            "updated_at": func.now(),
                        },
                    )
                    .returning(anon_quota_table.c.message_count)
                )
                raw = (await session.execute(statement)).scalar_one_or_none()
        return int(raw) if raw is not None else 0
