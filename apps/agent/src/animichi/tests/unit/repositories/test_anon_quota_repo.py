"""Unit tests for AnonQuotaRepository (issue #282 / S1.10)."""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock

import pytest

from animichi.infrastructure.supabase.repositories.anon_quota import AnonQuotaRepository

TODAY = date(2026, 7, 26)
ANON_ID = "anon_0123456789abcdef0123456789abcdef"


@pytest.fixture
def pool() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def repo(pool: AsyncMock) -> AnonQuotaRepository:
    return AnonQuotaRepository(pool)


async def test_increment_and_count_upserts_on_the_day_and_identity_key(
    repo: AnonQuotaRepository, pool: AsyncMock
) -> None:
    await repo.increment_and_count(usage_date=TODAY, anon_id=ANON_ID)
    sql = pool.fetchrow.await_args.args[0]
    assert "INSERT INTO anon_daily_message_count" in sql
    assert "ON CONFLICT (usage_date, anon_id) DO UPDATE" in sql


async def test_increment_and_count_adds_to_the_existing_total(
    repo: AnonQuotaRepository, pool: AsyncMock
) -> None:
    await repo.increment_and_count(usage_date=TODAY, anon_id=ANON_ID)
    sql = pool.fetchrow.await_args.args[0]
    assert "message_count = anon_daily_message_count.message_count + 1" in sql


async def test_increment_and_count_binds_the_day_and_identity(
    repo: AnonQuotaRepository, pool: AsyncMock
) -> None:
    await repo.increment_and_count(usage_date=TODAY, anon_id=ANON_ID)
    assert pool.fetchrow.await_args.args[1:] == (TODAY, ANON_ID)


async def test_increment_and_count_returns_the_new_total(
    repo: AnonQuotaRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"message_count": 4}
    assert await repo.increment_and_count(usage_date=TODAY, anon_id=ANON_ID) == 4


async def test_increment_and_count_is_zero_when_the_row_is_unexpectedly_absent(
    repo: AnonQuotaRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    assert await repo.increment_and_count(usage_date=TODAY, anon_id=ANON_ID) == 0
