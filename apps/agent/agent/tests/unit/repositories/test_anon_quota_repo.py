"""Unit tests for AnonQuotaRepository (issue #282 / S1.10)."""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock

import pytest

from agent.infrastructure.supabase.repositories.anon_quota import AnonQuotaRepository

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


async def test_purge_older_than_deletes_rows_before_the_cutoff(
    repo: AnonQuotaRepository, pool: AsyncMock
) -> None:
    pool.execute.return_value = "DELETE 3"
    assert await repo.purge_older_than(TODAY) == 3
    sql = pool.execute.await_args.args[0]
    assert "DELETE FROM anon_daily_message_count WHERE usage_date < $1" in sql
    assert pool.execute.await_args.args[1] == TODAY


async def test_purge_older_than_is_zero_for_an_unexpected_command_tag(
    repo: AnonQuotaRepository, pool: AsyncMock
) -> None:
    pool.execute.return_value = "UNEXPECTED"
    assert await repo.purge_older_than(TODAY) == 0
