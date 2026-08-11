"""Unit tests for SessionRepository."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from animichi.infrastructure.supabase.repositories.session import SessionRepository


@pytest.fixture
def pool() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def repo(pool: AsyncMock) -> SessionRepository:
    return SessionRepository(pool)


async def test_create_owned_session_uses_one_transaction(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    connection = AsyncMock()
    transaction = MagicMock()
    connection.transaction = MagicMock(return_value=transaction)
    acquire = MagicMock()
    acquire.__aenter__ = AsyncMock(return_value=connection)
    pool.acquire = MagicMock(return_value=acquire)
    await repo.create_owned_session("session-zero", "user-zero", "hello", {})
    assert connection.execute.await_count == 2
    transaction.__aenter__.assert_awaited_once()


async def test_upsert_session_calls_execute_with_correct_params(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.execute.return_value = None
    state: dict[str, object] = {"context": {"bangumi_id": "115908"}}
    metadata: dict[str, object] = {"locale": "ja"}
    await repo.upsert_session("sess-1", state, metadata)
    pool.execute.assert_awaited_once()
    call_args = pool.execute.await_args.args
    assert "INSERT INTO sessions" in call_args[0]
    assert call_args[1] == "sess-1"
    assert call_args[2] == json.dumps(state)
    assert call_args[3] == json.dumps(metadata)


async def test_upsert_session_defaults_metadata_to_empty(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.execute.return_value = None
    await repo.upsert_session("sess-1", {"key": "val"})
    call_args = pool.execute.await_args.args
    assert call_args[3] == json.dumps({})


async def test_get_session_returns_row(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"id": "sess-1", "state": "{}"}
    result = await repo.get_session("sess-1")
    assert result is not None
    assert result["id"] == "sess-1"


async def test_get_session_returns_none(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    result = await repo.get_session("missing")
    assert result is None


async def test_upsert_conversation_calls_execute(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.execute.return_value = None
    await repo.upsert_conversation("sess-1", "user-1", "Where is Liz filmed?")
    pool.execute.assert_awaited_once()
    sql = pool.execute.await_args.args[0]
    assert "INSERT INTO conversations" in sql
    update_sql = sql.split("DO UPDATE SET", maxsplit=1)[1]
    assert "user_id" not in update_sql


async def test_get_session_state_returns_dict(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"state": json.dumps({"bangumi_id": "1"})}
    result = await repo.get_session_state("sess-1")
    assert result == {"bangumi_id": "1"}


async def test_get_session_state_returns_none_when_missing(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    result = await repo.get_session_state("missing")
    assert result is None


async def test_delete_session_state_calls_execute(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.execute.return_value = None
    await repo.delete_session_state("sess-1")
    pool.execute.assert_awaited_once()
    sql = pool.execute.await_args.args[0]
    assert "DELETE FROM sessions" in sql


async def test_check_session_owner_returns_true_when_owned(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"?column?": 1}
    result = await repo.check_session_owner("sess-1", "user-1")
    assert result is True
    pool.fetchrow.assert_awaited_once()


async def test_check_session_owner_returns_false_when_not_owned(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    result = await repo.check_session_owner("sess-1", "user-999")
    assert result is False


async def test_adopt_ownership_repoints_and_returns_counts(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    connection = AsyncMock()
    transaction = MagicMock()
    connection.transaction = MagicMock(return_value=transaction)
    acquire = MagicMock()
    acquire.__aenter__ = AsyncMock(return_value=connection)
    pool.acquire = MagicMock(return_value=acquire)
    connection.fetch = AsyncMock(
        return_value=[{"session_id": "s-a"}, {"session_id": "s-b"}]
    )
    connection.fetchrow = AsyncMock(return_value={"session_id": "s-a"})

    result = await repo.adopt_ownership("anon_" + "a" * 32, "user-1")

    assert result.adopted_count == 2
    assert result.revisions_bumped == 2
    sql, to_user, from_anon = connection.fetch.await_args.args
    assert "UPDATE conversations" in sql
    assert to_user == "user-1"
    assert from_anon == "anon_" + "a" * 32


async def test_adopt_ownership_is_idempotent_second_run_is_a_no_op(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    connection = AsyncMock()
    transaction = MagicMock()
    connection.transaction = MagicMock(return_value=transaction)
    acquire = MagicMock()
    acquire.__aenter__ = AsyncMock(return_value=connection)
    pool.acquire = MagicMock(return_value=acquire)
    connection.fetch = AsyncMock(return_value=[])

    result = await repo.adopt_ownership("anon_" + "a" * 32, "user-1")

    assert result.adopted_count == 0
    assert result.revisions_bumped == 0
    connection.fetchrow.assert_not_called()


async def test_adopt_ownership_where_clause_only_ever_matches_the_anon_param(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    """Structural safety: the WHERE predicate binds to $2 (the anon id), so a
    real user's row is unmatchable by construction, not by a runtime guard."""
    connection = AsyncMock()
    transaction = MagicMock()
    connection.transaction = MagicMock(return_value=transaction)
    acquire = MagicMock()
    acquire.__aenter__ = AsyncMock(return_value=connection)
    pool.acquire = MagicMock(return_value=acquire)
    connection.fetch = AsyncMock(return_value=[])

    await repo.adopt_ownership("anon_" + "a" * 32, "user-1")

    sql = connection.fetch.await_args.args[0]
    assert "WHERE user_id = $2" in sql
    assert "SET user_id = $1" in sql


async def test_adopt_ownership_bumps_each_adopted_session_revision(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    """Mutation probe (SESSION-2 #960): the revision bump for each adopted
    session is the capability invalidation. Omitting it leaves
    `revisions_bumped` at 0 even though conversations moved."""
    connection = AsyncMock()
    transaction = MagicMock()
    connection.transaction = MagicMock(return_value=transaction)
    acquire = MagicMock()
    acquire.__aenter__ = AsyncMock(return_value=connection)
    pool.acquire = MagicMock(return_value=acquire)
    connection.fetch = AsyncMock(
        return_value=[{"session_id": "s-a"}, {"session_id": "s-b"}]
    )
    connection.fetchrow = AsyncMock(return_value={"session_id": "s-a"})

    result = await repo.adopt_ownership("anon_" + "a" * 32, "user-1")

    assert result.revisions_bumped == 2
    assert connection.fetchrow.await_count == 2
    bump_sql = connection.fetchrow.await_args_list[0].args[0]
    assert "INSERT INTO turn_reservations" in bump_sql
    assert "MAX(revision)" in bump_sql
