"""Unit tests for FinalSessionRepository — ownership adoption.

The adoption surfaces of the sole Session aggregate repository: the
identity-dimensional `UPDATE` on `sessions` plus the `turn_reservations`
revision CAS (SESSION-2 #960). The revision bump is the capability
invalidation and is a no-op under concurrency. No legacy adoption SQL.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from animichi.infrastructure.supabase.repositories.session import (
    FinalSessionRepository,
)


@pytest.fixture
def pool() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def repo(pool: AsyncMock) -> FinalSessionRepository:
    return FinalSessionRepository(pool)


def _wired_connection(pool: AsyncMock, rows: list[dict[str, object]]) -> AsyncMock:
    connection = AsyncMock()
    transaction = MagicMock()
    connection.transaction = MagicMock(return_value=transaction)
    acquire = MagicMock()
    acquire.__aenter__ = AsyncMock(return_value=connection)
    pool.acquire = MagicMock(return_value=acquire)
    connection.fetch = AsyncMock(return_value=rows)
    return connection


async def test_adopt_ownership_repoints_sessions_and_bumps_revisions(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    connection = _wired_connection(pool, [{"id": "s-a"}, {"id": "s-b"}])
    connection.fetchrow = AsyncMock(return_value={"session_id": "s-a"})

    result = await repo.adopt_ownership("anon_" + "a" * 32, "user-1")

    assert result.adopted_count == 2
    assert result.revisions_bumped == 2
    sql, to_user, from_anon = connection.fetch.await_args.args
    assert "UPDATE sessions SET user_id = $1" in sql
    assert "WHERE user_id = $2" in sql
    assert to_user == "user-1"
    assert from_anon == "anon_" + "a" * 32
    bump_sql = connection.fetchrow.await_args_list[0].args[0]
    assert "INSERT INTO turn_reservations" in bump_sql


async def test_adopt_ownership_second_run_is_a_no_op(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    connection = _wired_connection(pool, [])

    result = await repo.adopt_ownership("anon_" + "a" * 32, "user-1")

    assert result.adopted_count == 0
    assert result.revisions_bumped == 0
    connection.fetchrow.assert_not_called()


async def test_adopt_ownership_bump_uses_adopt_namespace_and_cas(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    """Mutation probe (SESSION-2 #960): the revision bump is the capability
    invalidation and must carry the reserved `adopt:` namespace with
    `ON CONFLICT DO NOTHING` so a concurrent bump is a no-op."""
    connection = _wired_connection(pool, [{"id": "s-a"}])
    connection.fetchrow = AsyncMock(return_value={"session_id": "s-a"})

    await repo.adopt_ownership("anon_" + "a" * 32, "user-1")

    bump_sql = connection.fetchrow.await_args.args[0]
    assert "MAX(revision)" in bump_sql
    assert "ON CONFLICT (session_id, revision) DO NOTHING" in bump_sql
    assert connection.fetchrow.await_args.args[1] == "s-a"
    assert connection.fetchrow.await_args.args[2].startswith("adopt:")
