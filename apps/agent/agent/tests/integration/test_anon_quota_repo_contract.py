"""Real-SQL contract for AnonQuotaRepository (issue #282 PR #472 review, P1-2).

The unit suite (`tests/unit/repositories/test_anon_quota_repo.py`) only
asserts on the SQL string against a mocked pool — it never executes the
statement, so a wrong column name, a missing grant, or a conflict target that
doesn't match the table's primary key would all still show green there and
only fail in production as a swallowed `_QUOTA_ERRORS` warning (the quota
fails open by design). This suite runs the real UPSERT against Postgres,
including the one correctness dimension neither the mocked unit test nor a
sequential integration test can prove: that the atomic UPSERT's row lock
actually serializes concurrent writers for the same key with no lost update.
"""

from __future__ import annotations

import asyncio
from datetime import date, timedelta

import asyncpg
import pytest

from agent.infrastructure.supabase.repositories.anon_quota import AnonQuotaRepository

pytestmark = pytest.mark.integration

TODAY = date(2026, 7, 26)
TOMORROW = date(2026, 7, 27)


def _anon_id(suffix: str) -> str:
    """A syntactically anon_-shaped id, unique per test to avoid collisions."""
    return f"anon_{suffix.rjust(32, '0')}"


async def _cleanup(pool: asyncpg.Pool, anon_ids: list[str]) -> None:
    await pool.execute(
        "DELETE FROM anon_daily_message_count WHERE anon_id = ANY($1::text[])",
        anon_ids,
    )


async def test_agent_svc_holds_the_grants_the_repo_needs(db_pool: asyncpg.Pool) -> None:
    """The migration's GRANT actually took — `has_table_privilege` probes the
    grant layer directly (same pattern as `test_service_roles.py`), catching
    a typo'd role name or a forgotten GRANT that a mocked unit test can't."""
    async with db_pool.acquire() as conn:
        select = await conn.fetchval(
            "SELECT has_table_privilege('agent_svc', 'public.anon_daily_message_count', 'SELECT')"
        )
        insert = await conn.fetchval(
            "SELECT has_table_privilege('agent_svc', 'public.anon_daily_message_count', 'INSERT')"
        )
        update = await conn.fetchval(
            "SELECT has_table_privilege('agent_svc', 'public.anon_daily_message_count', 'UPDATE')"
        )
    assert select is True
    assert insert is True
    assert update is True


async def test_the_same_key_increments_across_calls(db_pool: asyncpg.Pool) -> None:
    repo = AnonQuotaRepository(db_pool)
    anon_id = _anon_id("aaa1")
    try:
        first = await repo.increment_and_count(usage_date=TODAY, anon_id=anon_id)
        second = await repo.increment_and_count(usage_date=TODAY, anon_id=anon_id)
        assert (first, second) == (1, 2)
    finally:
        await _cleanup(db_pool, [anon_id])


async def test_different_identities_are_counted_independently(
    db_pool: asyncpg.Pool,
) -> None:
    repo = AnonQuotaRepository(db_pool)
    identity_a, identity_b = _anon_id("aaa2"), _anon_id("bbb2")
    try:
        await repo.increment_and_count(usage_date=TODAY, anon_id=identity_a)
        count_a = await repo.increment_and_count(usage_date=TODAY, anon_id=identity_a)
        count_b = await repo.increment_and_count(usage_date=TODAY, anon_id=identity_b)
        assert count_a == 2
        assert count_b == 1
    finally:
        await _cleanup(db_pool, [identity_a, identity_b])


async def test_different_dates_are_counted_independently(db_pool: asyncpg.Pool) -> None:
    repo = AnonQuotaRepository(db_pool)
    anon_id = _anon_id("aaa3")
    try:
        today_count = await repo.increment_and_count(usage_date=TODAY, anon_id=anon_id)
        tomorrow_count = await repo.increment_and_count(
            usage_date=TOMORROW, anon_id=anon_id
        )
        assert today_count == 1
        assert tomorrow_count == 1
    finally:
        await _cleanup(db_pool, [anon_id])


async def test_concurrent_increments_for_the_same_key_have_no_lost_update(
    db_pool: asyncpg.Pool,
) -> None:
    """N concurrent callers hitting the same (day, anon_id) row: the UPSERT's
    row lock must serialize them so the returned counts are exactly the set
    {1..N} — no duplicate value (a lost update) and no gap. This is the one
    correctness dimension a mocked-pool unit test structurally cannot cover.
    """
    repo = AnonQuotaRepository(db_pool)
    anon_id = _anon_id("ccc4")
    concurrent_callers = 20
    try:
        results = await asyncio.gather(
            *(
                repo.increment_and_count(usage_date=TODAY, anon_id=anon_id)
                for _ in range(concurrent_callers)
            )
        )
        assert set(results) == set(range(1, concurrent_callers + 1))
    finally:
        await _cleanup(db_pool, [anon_id])


async def test_purge_older_than_removes_stale_rows_and_keeps_recent_ones(
    db_pool: asyncpg.Pool,
) -> None:
    repo = AnonQuotaRepository(db_pool)
    stale_id, fresh_id = _anon_id("ddd5"), _anon_id("eee5")
    stale_date = TODAY - timedelta(days=100)
    try:
        await repo.increment_and_count(usage_date=stale_date, anon_id=stale_id)
        await repo.increment_and_count(usage_date=TODAY, anon_id=fresh_id)
        removed = await repo.purge_older_than(TODAY)
        remaining = await db_pool.fetchval(
            "SELECT count(*) FROM anon_daily_message_count WHERE anon_id = $1",
            stale_id,
        )
        still_there = await db_pool.fetchval(
            "SELECT count(*) FROM anon_daily_message_count WHERE anon_id = $1",
            fresh_id,
        )
        assert removed >= 1
        assert remaining == 0
        assert still_there == 1
    finally:
        await _cleanup(db_pool, [stale_id, fresh_id])
