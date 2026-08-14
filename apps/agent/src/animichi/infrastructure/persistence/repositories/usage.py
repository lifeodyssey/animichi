"""SQLModel daily-usage meter repository (#995).

Replaces the asyncpg ``UsageRepository``: the same scope-partitioned
accumulate/read contract against ``daily_usage``, expressed with
SQLModel/SQLAlchemy statements. ``cost_usd`` is bound as ``Decimal`` to
mirror the legacy NUMERIC handling exactly. The turn metrics travel in a
frozen ``_UsageMetrics`` value object so 6-argument forwarding stays short
(1-10-50).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.sql.dml import Insert
from sqlalchemy.sql.selectable import Select

from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.models import daily_usage_table


@dataclass(frozen=True)
class _UsageMetrics:
    """The per-turn counters added to a daily usage row."""

    requests: int
    input_tokens: int
    output_tokens: int
    cost_usd: float


def _as_usd(value: object) -> float:
    """Coerce a NUMERIC column (SQLAlchemy yields Decimal) into a float."""
    if isinstance(value, (Decimal, int, float)):
        return float(value)
    return 0.0


def _usage_values(
    usage_date: date, scope: str, metrics: _UsageMetrics
) -> dict[str, object]:
    "The insert columns for one day-scope usage row."
    return {
        "usage_date": usage_date,
        "scope": scope,
        "requests": metrics.requests,
        "input_tokens": metrics.input_tokens,
        "output_tokens": metrics.output_tokens,
        "cost_usd": Decimal(str(metrics.cost_usd)),
    }


def _usage_patch(metrics: _UsageMetrics) -> dict[str, object]:
    "The conflict-patch columns that add the turn to the existing row."
    return {
        "requests": daily_usage_table.c.requests + metrics.requests,
        "input_tokens": daily_usage_table.c.input_tokens + metrics.input_tokens,
        "output_tokens": daily_usage_table.c.output_tokens + metrics.output_tokens,
        "cost_usd": daily_usage_table.c.cost_usd + Decimal(str(metrics.cost_usd)),
        "updated_at": func.now(),
    }


def _usage_statement(usage_date: date, scope: str, metrics: _UsageMetrics) -> Insert:
    "The atomic day-scope upsert that adds the turn to any existing row."
    return (
        pg_insert(daily_usage_table)
        .values(**_usage_values(usage_date, scope, metrics))
        .on_conflict_do_update(
            index_elements=[daily_usage_table.c.usage_date, daily_usage_table.c.scope],
            set_=_usage_patch(metrics),
        )
    )


def _usage_select(usage_date: date, scope: str) -> Select:
    "The day-scope spend column read."
    return select(daily_usage_table.c.cost_usd).where(
        daily_usage_table.c.usage_date == usage_date,
        daily_usage_table.c.scope == scope,
    )


async def _accumulate_many(
    sessionmaker: AsyncSessionFactory,
    usage_date: date,
    scope: str,
    metrics: _UsageMetrics,
) -> None:
    async with sessionmaker() as session:
        async with session.begin():
            await session.execute(_usage_statement(usage_date, scope, metrics))


async def _total_cost(
    sessionmaker: AsyncSessionFactory, usage_date: date, scope: str
) -> float:
    async with sessionmaker() as session:
        raw = (
            await session.execute(_usage_select(usage_date, scope))
        ).scalar_one_or_none()
    return _as_usd(raw)


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
        """Upsert one day-scope row, adding the turn to any existing."""
        metrics = _UsageMetrics(requests, input_tokens, output_tokens, cost_usd)
        await _accumulate_many(self._sessionmaker, usage_date, scope, metrics)

    async def total_cost_usd(self, *, usage_date: date, scope: str) -> float:
        """The day-scope cumulative spend; 0.0 when no row exists yet."""
        return await _total_cost(self._sessionmaker, usage_date, scope)


__all__ = ["SQLModelUsageRepository"]
