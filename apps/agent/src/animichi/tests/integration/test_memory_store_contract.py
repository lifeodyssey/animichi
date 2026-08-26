"""PostgreSQL contract for the SQLModel Memory store (#995).

``SQLModelMemoryStore`` implements the harness ``MemoryStore`` +
``SearchableMemoryStore`` protocols with typed SQLAlchemy statements; this
suite exercises the versioned CAS, operation receipts, path isolation, and
bounded search against real PostgreSQL 18. The schema test probes the Atlas
migration ledger and stays an asyncpg infra check (Atlas migration SQL is
outside the repository raw-SQL policy, #999).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import asyncpg
import pytest

from animichi.infrastructure.persistence.database import (
    DatabaseLifecycle,
    create_database_lifecycle,
)
from animichi.infrastructure.persistence.repositories.memory import (
    SQLModelMemoryStore,
)
from animichi.tests.conftest_db import DatabaseTarget

_MIGRATIONS = Path(__file__).resolve().parents[6] / "migrations" / "neon"
_TABLES = {
    "agent_memory",
    "agent_memory_operations",
    "agent_memory_metadata",
}


async def _cleanup(db: SQLModelMemoryStore) -> None:
    from sqlalchemy import delete

    from animichi.infrastructure.persistence.models import (
        memory_operations_table,
        memory_table,
    )

    async with db._sessionmaker() as session:
        async with session.begin():
            await session.execute(
                delete(memory_operations_table).where(
                    memory_operations_table.c.id.like("issue-19-%")
                )
            )
            await session.execute(
                delete(memory_table).where(memory_table.c.path.like("issue-19-%"))
            )


@pytest.fixture
async def store(
    pg_container: DatabaseTarget,
) -> AsyncIterator[SQLModelMemoryStore]:
    lifecycle: DatabaseLifecycle = create_database_lifecycle(pg_container.dsn)
    try:
        yield SQLModelMemoryStore(lifecycle.sessionmaker)
    finally:
        await lifecycle.close()


def _chain_versions() -> set[str]:
    """Atlas keys one ledger revision per migration file, by its version prefix."""
    versions = {path.name.split("_", 1)[0] for path in _MIGRATIONS.glob("*.sql")}
    if not versions:
        raise AssertionError(f"no migrations found in {_MIGRATIONS}")
    return versions


async def test_memory_schema_lands_through_atlas_migration(
    db_pool: asyncpg.Pool,
) -> None:
    expected_versions = _chain_versions()
    revisions = await db_pool.fetch(
        "SELECT version FROM public.atlas_schema_revisions WHERE version = ANY($1::text[])",
        sorted(expected_versions),
    )
    rows = await db_pool.fetch(
        "SELECT tablename FROM pg_tables "
        "WHERE schemaname = 'public' AND tablename = ANY($1::text[])",
        sorted(_TABLES),
    )
    sequence = await db_pool.fetchval(
        "SELECT to_regclass('public.agent_memory_versions')::text"
    )

    assert {row["version"] for row in revisions} == expected_versions
    assert {row["tablename"] for row in rows} == _TABLES
    assert sequence == "agent_memory_versions"


async def test_store_roundtrip_and_search(store: SQLModelMemoryStore) -> None:
    await _cleanup(store)
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


async def test_paths_isolate_user_namespaces_at_the_store_layer(
    store: SQLModelMemoryStore,
) -> None:
    await _cleanup(store)
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
    listed = await store.list_paths("issue-19-user-", limit=10)

    assert [match.path for match in visible_a.matches] == [path_a]
    assert listed == [path_a, path_b]


async def test_write_cas_and_operation_receipts(
    store: SQLModelMemoryStore,
) -> None:
    await _cleanup(store)
    from pydantic_ai_harness.memory import MemoryConflictError, MemoryOperation

    path = "issue-19-cas/main/MEMORY.md"
    operation = MemoryOperation(id="issue-19-op-1", fingerprint="fp-1")

    first = await store.write(
        path, "content v1", expected_version=None, operation=operation
    )
    replayed = await store.write(
        path, "content v1", expected_version=None, operation=operation
    )
    assert replayed.replayed is True
    assert replayed.version == first.version

    with pytest.raises(MemoryConflictError):
        await store.write(path, "content v2", expected_version="0")

    second = await store.write(path, "content v2", expected_version=first.version)
    saved = await store.read(path, max_chars=1_000)
    assert saved is not None
    assert saved.content == "content v2"
    assert saved.version == second.version


async def test_delete_cas_and_version_bump(store: SQLModelMemoryStore) -> None:
    await _cleanup(store)
    from pydantic_ai_harness.memory import MemoryConflictError

    path = "issue-19-delete/main/MEMORY.md"
    mutation = await store.write(path, "ephemeral", expected_version=None)

    with pytest.raises(MemoryConflictError):
        await store.delete(path, expected_version="0")

    deleted = await store.delete(path, expected_version=mutation.version)
    assert deleted.existed is True
    assert await store.read(path, max_chars=100) is None
    noop = await store.delete(path, expected_version=None)
    assert noop.existed is False
