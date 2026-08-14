"""Real-Postgres contract for the SQLModel anon-quota repository (#995).

Runs the SQLModel repository's atomic UPSERT against PostgreSQL 18 — the one
correctness dimension a mocked-session unit test structurally cannot prove:
the row lock actually serializes concurrent writers for the same key with no
lost update. Grant assertions probe the Atlas migration's GRANT layer
directly and remain asyncpg infra checks (Atlas migration SQL is outside the
repository raw-SQL policy, #999).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import date

import asyncpg
import pytest

from animichi.infrastructure.persistence.database import (
    DatabaseLifecycle,
    create_database_lifecycle,
)
from animichi.infrastructure.persistence.repositories.anon_quota import (
    SQLModelAnonQuotaRepository,
)
from animichi.tests.conftest_db import DatabaseTarget

pytestmark = pytest.mark.integration

TODAY = date(2026, 7, 26)
TOMORROW = date(2026, 7, 27)


def _anon_id(suffix: str) -> str:
    """A syntactically anon_-shaped id, unique per test to avoid collisions."""
    return f"anon_{suffix.rjust(32, '0')}"


async def _cleanup(repo: SQLModelAnonQuotaRepository, anon_ids: list[str]) -> None:
    from sqlalchemy import delete

    from animichi.infrastructure.persistence.models import anon_quota_table

    async with repo._sessionmaker() as session:
        async with session.begin():
            await session.execute(
                delete(anon_quota_table).where(anon_quota_table.c.anon_id.in_(anon_ids))
            )


@pytest.fixture
async def repo(
    pg_container: DatabaseTarget,
) -> AsyncIterator[SQLModelAnonQuotaRepository]:
    lifecycle: DatabaseLifecycle = create_database_lifecycle(pg_container.dsn)
    try:
        yield SQLModelAnonQuotaRepository(lifecycle.sessionmaker)
    finally:
        await lifecycle.close()


# The repo's operations against this table (issue #661): the UPSERT
# (`increment_and_count`) needs SELECT/INSERT/UPDATE. One parametrize case per
# privilege keeps each test body under the 1-10-50 function-length limit *and*
# makes a missing grant self-diagnosing — a failure names the exact privilege
# that's missing (`test_agent_svc_holds_the_grant[INSERT]`) instead of a
# single bundled assertion that only says "grants are wrong".
_REPO_PRIVILEGES = ("SELECT", "INSERT", "UPDATE")


@pytest.mark.parametrize("privilege", _REPO_PRIVILEGES)
async def test_agent_svc_holds_the_grant(db_pool: asyncpg.Pool, privilege: str) -> None:
    """The migration's GRANT actually took — `has_table_privilege` probes the
    grant layer directly (same pattern as `test_service_roles.py`), catching a
    typo'd role name or a forgotten GRANT that a mocked unit test can't.
    """
    async with db_pool.acquire() as conn:
        held = await conn.fetchval(
            "SELECT has_table_privilege('agent_svc', 'public.anon_daily_message_count', $1)",
            privilege,
        )
    assert held is True


async def test_the_same_key_increments_across_calls(
    repo: SQLModelAnonQuotaRepository,
) -> None:
    anon_id = _anon_id("aaa1")
    try:
        first = await repo.increment_and_count(usage_date=TODAY, anon_id=anon_id)
        second = await repo.increment_and_count(usage_date=TODAY, anon_id=anon_id)
        assert (first, second) == (1, 2)
    finally:
        await _cleanup(repo, [anon_id])


async def test_different_identities_are_counted_independently(
    repo: SQLModelAnonQuotaRepository,
) -> None:
    identity_a, identity_b = _anon_id("aaa2"), _anon_id("bbb2")
    try:
        await repo.increment_and_count(usage_date=TODAY, anon_id=identity_a)
        count_a = await repo.increment_and_count(usage_date=TODAY, anon_id=identity_a)
        count_b = await repo.increment_and_count(usage_date=TODAY, anon_id=identity_b)
        assert count_a == 2
        assert count_b == 1
    finally:
        await _cleanup(repo, [identity_a, identity_b])


async def test_different_dates_are_counted_independently(
    repo: SQLModelAnonQuotaRepository,
) -> None:
    anon_id = _anon_id("aaa3")
    try:
        today_count = await repo.increment_and_count(usage_date=TODAY, anon_id=anon_id)
        tomorrow_count = await repo.increment_and_count(
            usage_date=TOMORROW, anon_id=anon_id
        )
        assert today_count == 1
        assert tomorrow_count == 1
    finally:
        await _cleanup(repo, [anon_id])


async def test_concurrent_increments_for_the_same_key_have_no_lost_update(
    repo: SQLModelAnonQuotaRepository,
) -> None:
    """N concurrent callers hitting the same (day, anon_id) row: the UPSERT's
    row lock must serialize them so the returned counts are exactly the set
    {1..N} — no duplicate value (a lost update) and no gap. This is the one
    correctness dimension a mocked-session unit test structurally cannot
    cover.
    """
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
        await _cleanup(repo, [anon_id])
