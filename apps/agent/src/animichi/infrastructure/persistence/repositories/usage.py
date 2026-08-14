"""SQLModel daily-usage meter repository (#995).

Replaces the asyncpg ``UsageRepository``: the same scope-partitioned
accumulate/read contract against ``daily_usage``, expressed with
SQLModel/SQLAlchemy statements. ``cost_usd`` is bound as ``Decimal`` to
mirror the legacy NUMERIC handling exactly.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.models import daily_usage_table


def _as_usd(value: object) -> float:
    """Coerce a NUMERIC column (SQLAlchemy yields Decimal) into a float."""
    if isinstance(value, (Decimal, int, float)):
        return float(value)
    return 0.0


class SQLModelUsageRepository:
    """Daily model-usage meter operations (issue #274 / S1.8)."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker

    async def accumulate_usage(
        self,
        *,
        usage_date: date,
        scope: str,
        requests: int,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> None:
        """Upsert one day-scope row, adding the turn's usage to any existing."""
        async with self._sessionmaker() as session:
            async with session.begin():
                statement = (
                    pg_insert(daily_usage_table)
                    .values(
                        usage_date=usage_date,
                        scope=scope,
                        requests=requests,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        cost_usd=Decimal(str(cost_usd)),
                    )
                    .on_conflict_do_update(
                        index_elements=[
                            daily_usage_table.c.usage_date,
                            daily_usage_table.c.scope,
                        ],
                        set_={
                            "requests": daily_usage_table.c.requests + requests,
                            "input_tokens": daily_usage_table.c.input_tokens
                            + input_tokens,
                            "output_tokens": daily_usage_table.c.output_tokens
                            + output_tokens,
                            "cost_usd": daily_usage_table.c.cost_usd
                            + Decimal(str(cost_usd)),
                            "updated_at": func.now(),
                        },
                    )
                )
                await session.execute(statement)

    async def total_cost_usd(self, *, usage_date: date, scope: str) -> float:
        """The day-scope cumulative spend; 0.0 when no row exists yet."""
        async with self._sessionmaker() as session:
            raw = (
                await session.execute(
                    select(daily_usage_table.c.cost_usd).where(
                        daily_usage_table.c.usage_date == usage_date,
                        daily_usage_table.c.scope == scope,
                    )
                )
            ).scalar_one_or_none()
        return _as_usd(raw)
