"""Lead-run acceptance checks for every Phase A database arm."""

from __future__ import annotations

import os
from pathlib import Path

import asyncpg
import pytest

from agent.tests.atlas_helper import expected_revisions
from agent.tests.conftest_db import DatabaseTarget

pytestmark = pytest.mark.integration
SEED_FILE = Path(__file__).parents[1] / "fixtures" / "seed.sql"


async def test_atlas_ledger_is_public_and_single(db_pool: asyncpg.Pool) -> None:
    public_ledger = await db_pool.fetchval(
        "SELECT to_regclass('public.atlas_schema_revisions')"
    )
    duplicate_schema = await db_pool.fetchval(
        "SELECT to_regnamespace('atlas_schema_revisions')"
    )
    latest = await db_pool.fetchval(
        "SELECT max(version) FROM public.atlas_schema_revisions"
    )
    assert str(public_ledger) == "atlas_schema_revisions"
    assert duplicate_schema is None
    assert latest == expected_revisions()[-1]


async def test_pgvector_1024_round_trip_and_hnsw_exist(
    db_pool: asyncpg.Pool,
) -> None:
    vector = "[" + ",".join(["0"] * 1024) + "]"
    dimensions = await db_pool.fetchval("SELECT vector_dims($1::vector)", vector)
    vector_type = await db_pool.fetchval(
        """
        SELECT format_type(attribute.atttypid, attribute.atttypmod)
        FROM pg_attribute AS attribute
        WHERE attribute.attrelid = 'public.points'::regclass
          AND attribute.attname = 'embedding'
        """
    )
    hnsw = await db_pool.fetchval(
        """
        SELECT indexdef ILIKE '%using hnsw%'
        FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_points_embedding'
        """
    )
    assert dimensions == 1024
    assert vector_type == "vector(1024)"
    assert hnsw is True


async def test_seed_reapply_is_idempotent(db_pool: asyncpg.Pool) -> None:
    before = await db_pool.fetchrow(
        "SELECT (SELECT count(*) FROM bangumi), (SELECT count(*) FROM points)"
    )
    await db_pool.execute(SEED_FILE.read_text(encoding="utf-8"))
    after = await db_pool.fetchrow(
        "SELECT (SELECT count(*) FROM bangumi), (SELECT count(*) FROM points)"
    )
    assert before is not None
    assert after is not None
    assert tuple(before) == tuple(after)


@pytest.mark.skipif(os.environ.get("TEST_DB") != "neon", reason="Neon arm only")
def test_neon_suite_dsn_never_uses_localhost(pg_container: DatabaseTarget) -> None:
    assert pg_container.arm.value == "neon"
    assert "localhost" not in pg_container.dsn
    assert "127.0.0.1" not in pg_container.dsn
