"""PostgreSQL contract for the official harness Memory store."""

from __future__ import annotations

import asyncpg
from pydantic_ai_harness.memory import PostgresMemoryStore

_MIGRATION_VERSION = "20260719000001"
_TABLES = {
    "agent_memory",
    "agent_memory_operations",
    "agent_memory_metadata",
}


async def _cleanup(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as connection:
        await connection.execute(
            "DELETE FROM agent_memory WHERE path LIKE 'issue-19-%'"
        )
        await connection.execute(
            "DELETE FROM agent_memory_operations WHERE id LIKE 'issue-19-%'"
        )


async def test_memory_schema_lands_through_atlas_migration(
    db_pool: asyncpg.Pool,
) -> None:
    revision = await db_pool.fetchval(
        "SELECT version FROM public.atlas_schema_revisions WHERE version = $1",
        _MIGRATION_VERSION,
    )
    rows = await db_pool.fetch(
        "SELECT tablename FROM pg_tables "
        "WHERE schemaname = 'public' AND tablename = ANY($1::text[])",
        sorted(_TABLES),
    )
    sequence = await db_pool.fetchval(
        "SELECT to_regclass('public.agent_memory_versions')::text"
    )

    assert revision == _MIGRATION_VERSION
    assert {row["tablename"] for row in rows} == _TABLES
    assert sequence == "agent_memory_versions"


async def test_postgres_store_roundtrip_and_search(db_pool: asyncpg.Pool) -> None:
    await _cleanup(db_pool)
    store = PostgresMemoryStore(db_pool)
    path = "issue-19-roundtrip/main/MEMORY.md"

    mutation = await store.write(
        path, "Prefers quiet temples in Kyoto.", expected_version=None
    )
    saved = await store.read(path, max_chars=1_000)
    found = await store.search(
        "issue-19-roundtrip/main/",
        "quiet temples",
        limit=10,
        max_files=10,
        max_chars=1_000,
        max_file_chars=1_000,
    )

    assert saved is not None
    assert saved.content == "Prefers quiet temples in Kyoto."
    assert saved.version == mutation.version
    assert [match.path for match in found.matches] == [path]


async def test_postgres_paths_isolate_user_namespaces_at_sql_layer(
    db_pool: asyncpg.Pool,
) -> None:
    await _cleanup(db_pool)
    store = PostgresMemoryStore(db_pool)
    path_a = "issue-19-user-a/main/MEMORY.md"
    path_b = "issue-19-user-b/main/MEMORY.md"
    await store.write(path_a, "Likes quiet shrines.", expected_version=None)
    await store.write(path_b, "Likes lively arcades.", expected_version=None)

    visible_a = await store.search(
        "issue-19-user-a/main/",
        "likes",
        limit=10,
        max_files=10,
        max_chars=1_000,
        max_file_chars=1_000,
    )
    sql_paths = await db_pool.fetch(
        "SELECT path FROM agent_memory WHERE path LIKE 'issue-19-user-%' ORDER BY path"
    )

    assert [match.path for match in visible_a.matches] == [path_a]
    assert [row["path"] for row in sql_paths] == [path_a, path_b]
