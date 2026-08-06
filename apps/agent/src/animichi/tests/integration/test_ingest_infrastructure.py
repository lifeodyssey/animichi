"""Wave 1 ingest-infrastructure schema contracts (testcontainer).

AC1 singleflight, AC2 atomic version pointer, AC4 negative cache.
AC3 (catalog SELECT-only role) is a structural guarantee that requires distinct
DB roles; the testcontainer runs as superuser, so it is enforced in
ops/Supabase (documented), not asserted here.
"""

import asyncpg
import pytest

pytestmark = pytest.mark.integration


async def test_ingest_jobs_pk_is_singleflight(db_pool: asyncpg.Pool) -> None:
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM ingest_jobs WHERE work_id = 'sf_test'")
        await conn.execute(
            "INSERT INTO ingest_jobs (work_id, status) VALUES ('sf_test', 'running') "
            "ON CONFLICT (work_id) DO NOTHING"
        )
        await conn.execute(
            "INSERT INTO ingest_jobs (work_id, status) VALUES ('sf_test', 'running') "
            "ON CONFLICT (work_id) DO NOTHING"
        )
        count = await conn.fetchval(
            "SELECT count(*) FROM ingest_jobs WHERE work_id = 'sf_test'"
        )

    assert count == 1


async def test_cluster_version_allows_one_current_per_work(
    db_pool: asyncpg.Pool,
) -> None:
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM cluster_version WHERE work_id = 'cv_test'")
        await conn.execute(
            "INSERT INTO cluster_version (work_id, version, is_current) "
            "VALUES ('cv_test', 1, true)"
        )
        with pytest.raises(asyncpg.UniqueViolationError):
            await conn.execute(
                "INSERT INTO cluster_version (work_id, version, is_current) "
                "VALUES ('cv_test', 2, true)"
            )


async def test_negative_cache_column_persists(db_pool: asyncpg.Pool) -> None:
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM ingest_jobs WHERE work_id = 'neg_test'")
        await conn.execute(
            "INSERT INTO ingest_jobs (work_id, status, error_code, "
            "negative_cached_until) VALUES ('neg_test', 'failed', 'not_found', "
            "NOW() + INTERVAL '1 hour')"
        )
        cached = await conn.fetchval(
            "SELECT negative_cached_until > NOW() FROM ingest_jobs "
            "WHERE work_id = 'neg_test'"
        )

    assert cached is True


async def test_cluster_version_atomic_switch(db_pool: asyncpg.Pool) -> None:
    """Blue/green publish: flip old current off then insert new current, in one txn.
    The partial unique index forces this ordering (insert-then-flip would violate it).
    """
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM cluster_version WHERE work_id = 'switch_test'")
        await conn.execute(
            "INSERT INTO cluster_version (work_id, version, is_current) "
            "VALUES ('switch_test', 1, true)"
        )
        async with conn.transaction():
            await conn.execute(
                "UPDATE cluster_version SET is_current = false "
                "WHERE work_id = 'switch_test' AND is_current"
            )
            await conn.execute(
                "INSERT INTO cluster_version (work_id, version, is_current) "
                "VALUES ('switch_test', 2, true)"
            )
        current = await conn.fetch(
            "SELECT version FROM cluster_version "
            "WHERE work_id = 'switch_test' AND is_current"
        )

    assert [r["version"] for r in current] == [2]
