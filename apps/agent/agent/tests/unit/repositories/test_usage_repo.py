"""Unit tests for UsageRepository (issue #274 / S1.8)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest

from agent.infrastructure.supabase.repositories.usage import UsageRepository

TODAY = date(2026, 7, 26)


@pytest.fixture
def pool() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def repo(pool: AsyncMock) -> UsageRepository:
    return UsageRepository(pool)


async def test_accumulate_usage_upserts_on_the_day_and_scope_key(
    repo: UsageRepository, pool: AsyncMock
) -> None:
    await repo.accumulate_usage(
        usage_date=TODAY,
        scope="anon",
        requests=1,
        input_tokens=100,
        output_tokens=50,
        cost_usd=0.25,
    )
    sql = pool.execute.await_args.args[0]
    assert "INSERT INTO daily_usage" in sql
    assert "ON CONFLICT (usage_date, scope) DO UPDATE" in sql


async def test_accumulate_usage_adds_to_the_existing_totals(
    repo: UsageRepository, pool: AsyncMock
) -> None:
    await repo.accumulate_usage(
        usage_date=TODAY,
        scope="anon",
        requests=1,
        input_tokens=100,
        output_tokens=50,
        cost_usd=0.25,
    )
    sql = pool.execute.await_args.args[0]
    assert "cost_usd = daily_usage.cost_usd + EXCLUDED.cost_usd" in sql


async def test_accumulate_usage_binds_cost_as_a_numeric_decimal(
    repo: UsageRepository, pool: AsyncMock
) -> None:
    await repo.accumulate_usage(
        usage_date=TODAY,
        scope="anon",
        requests=1,
        input_tokens=100,
        output_tokens=50,
        cost_usd=0.25,
    )
    assert pool.execute.await_args.args[-1] == Decimal("0.25")


async def test_total_cost_usd_converts_the_numeric_column_to_a_float(
    repo: UsageRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"cost_usd": Decimal("4.125")}
    assert await repo.total_cost_usd(usage_date=TODAY, scope="anon") == 4.125


async def test_total_cost_usd_is_zero_for_a_day_with_no_usage(
    repo: UsageRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    assert await repo.total_cost_usd(usage_date=TODAY, scope="anon") == 0.0


async def test_total_cost_usd_is_zero_when_the_column_is_null(
    repo: UsageRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"cost_usd": None}
    assert await repo.total_cost_usd(usage_date=TODAY, scope="anon") == 0.0
