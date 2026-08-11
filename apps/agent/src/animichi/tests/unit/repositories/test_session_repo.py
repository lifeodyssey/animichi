"""Unit tests for FinalSessionRepository (SESSION-3 #961).

The sole Session aggregate repository: create/load/commit/history/adoption
against the fresh-schema manifest (`sessions` ownership + state, ordered
`messages` transcript, `turn_reservations` revision CAS). No second root.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from animichi.infrastructure.supabase.repositories.session import (
    FinalSessionRepository,
    MessageRow,
)


@pytest.fixture
def pool() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def repo(pool: AsyncMock) -> FinalSessionRepository:
    return FinalSessionRepository(pool)


async def test_create_inserts_one_session_aggregate_row(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    state: dict[str, object] = {"interactions": []}
    await repo.create("session-zero", "user-zero", "hello", state)
    pool.execute.assert_awaited_once()
    sql, session_id, user_id, first_query, raw_state = pool.execute.await_args.args
    assert "INSERT INTO sessions" in sql
    assert session_id == "session-zero"
    assert user_id == "user-zero"
    assert first_query == "hello"
    assert raw_state == json.dumps(state)
    assert "conversations" not in sql


async def test_load_returns_typed_session_record(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {
        "id": "sess-1",
        "user_id": "user-1",
        "title": "Kyoto trip",
        "first_query": "どこ行こう",
        "state": json.dumps({"interactions": []}),
        "metadata": None,
    }
    record = await repo.load("sess-1")
    assert record is not None
    assert record.session_id == "sess-1"
    assert record.user_id == "user-1"
    assert record.title == "Kyoto trip"
    assert record.state == {"interactions": []}
    sql = pool.fetchrow.await_args.args[0]
    assert "FROM sessions" in sql


async def test_load_missing_returns_none(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    assert await repo.load("missing") is None


async def test_upsert_session_records_owner_and_state(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    state: dict[str, object] = {"context": {"bangumi_id": "115908"}}
    await repo.upsert_session("sess-1", state, user_id="anon_a" * 4)
    pool.execute.assert_awaited_once()
    call_args = pool.execute.await_args.args
    assert "INSERT INTO sessions" in call_args[0]
    assert call_args[1] == "sess-1"
    assert call_args[2] == "anon_a" * 4
    assert call_args[3] == json.dumps(state)
    assert "user_id = COALESCE(EXCLUDED.user_id, sessions.user_id)" in call_args[0]


async def test_upsert_session_without_owner_preserves_existing(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    await repo.upsert_session("sess-1", {"key": "val"})
    sql = pool.execute.await_args.args[0]
    assert "user_id = COALESCE(EXCLUDED.user_id, sessions.user_id)" in sql


async def test_get_session_state_returns_dict(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"state": json.dumps({"bangumi_id": "1"})}
    assert await repo.get_session_state("sess-1") == {"bangumi_id": "1"}


async def test_get_session_state_missing_returns_none(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    assert await repo.get_session_state("missing") is None


async def test_upsert_session_state_writes_state_envelope(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    await repo.upsert_session_state("sess-1", {"interactions": []})
    sql = pool.execute.await_args.args[0]
    assert "INSERT INTO sessions" in sql
    assert "ON CONFLICT" in sql


async def test_delete_session_state_calls_execute(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    await repo.delete_session_state("sess-1")
    sql = pool.execute.await_args.args[0]
    assert "DELETE FROM sessions" in sql


async def test_check_session_owner_reads_the_aggregate_row(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"?column?": 1}
    assert await repo.check_session_owner("sess-1", "user-1") is True
    sql = pool.fetchrow.await_args.args[0]
    assert "FROM sessions WHERE id = $1 AND user_id = $2" in sql


async def test_list_sessions_returns_user_sessions(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [{"session_id": "sess-1", "title": "T"}]
    result = await repo.list_sessions("user-1")
    assert result == [{"session_id": "sess-1", "title": "T"}]
    sql = pool.fetch.await_args.args[0]
    assert "FROM sessions WHERE user_id = $1" in sql


async def test_update_title_requires_owner_match(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"id": "sess-1"}
    assert await repo.update_title("sess-1", "T", user_id="user-1") is True
    sql = pool.fetchrow.await_args.args[0]
    assert "UPDATE sessions SET title = $1" in sql
    assert "user_id = $3" in sql


async def test_update_title_without_owner_updates_any(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    assert await repo.update_title("sess-1", "T") is False
    sql = pool.fetchrow.await_args.args[0]
    assert "user_id = $3" not in sql


async def test_insert_message_targets_messages_table(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    await repo.insert_message("sess-1", "user", "Hello", {"intent": "x"})
    sql = pool.execute.await_args.args[0]
    assert "INSERT INTO messages" in sql
    assert pool.execute.await_args.args[1] == "sess-1"
    assert pool.execute.await_args.args[2] == "user"
    assert pool.execute.await_args.args[4] == json.dumps({"intent": "x"})


async def test_get_messages_returns_ordered_rows(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [
        {
            "role": "user",
            "content": "Hi",
            "response_data": None,
            "created_at": "2026-01-01T00:00:00Z",
        },
        {
            "role": "assistant",
            "content": "Hello",
            "response_data": None,
            "created_at": "2026-01-01T00:01:00Z",
        },
    ]
    result = await repo.get_messages("sess-1", limit=50)
    assert [row.role for row in result] == ["user", "assistant"]
    assert isinstance(result[0], MessageRow)
    sql = pool.fetch.await_args.args[0]
    assert "FROM messages" in sql
    assert "ORDER BY created_at ASC" in sql
    assert "LIMIT $2 OFFSET $3" in sql


async def test_current_revision_reads_turn_reservations(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"revision": 7}
    assert await repo.current_revision("sess-1") == 7
    sql = pool.fetchrow.await_args.args[0]
    assert "FROM turn_reservations" in sql


async def test_history_returns_owned_ordered_page_and_revision(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.side_effect = [{"?column?": 1}, {"revision": 7}]
    pool.fetch.return_value = [
        {
            "role": "user",
            "content": "first",
            "response_data": None,
            "created_at": "2026-01-01T00:00:00Z",
        }
    ]
    page = await repo.history("sess-1", "user-1", limit=100, offset=0)
    assert page is not None
    assert page.user_id == "user-1"
    assert page.messages[0].content == "first"
    assert page.revision == 7
    owner_sql = pool.fetchrow.await_args_list[0].args[0]
    assert "FROM sessions WHERE id = $1 AND user_id = $2" in owner_sql
    messages_sql = pool.fetch.await_args.args[0]
    assert "FROM messages" in messages_sql


async def test_history_forbidden_session_collapses_to_none(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    assert await repo.history("sess-1", "other", limit=100, offset=0) is None
    pool.fetch.assert_not_awaited()


async def test_adopt_ownership_repoints_sessions_and_bumps_revisions(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    connection = AsyncMock()
    transaction = MagicMock()
    connection.transaction = MagicMock(return_value=transaction)
    acquire = MagicMock()
    acquire.__aenter__ = AsyncMock(return_value=connection)
    pool.acquire = MagicMock(return_value=acquire)
    connection.fetch = AsyncMock(return_value=[{"id": "s-a"}, {"id": "s-b"}])
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


async def test_adopt_ownership_bump_uses_adopt_namespace_and_cas(
    repo: FinalSessionRepository, pool: AsyncMock
) -> None:
    """Mutation probe (SESSION-2 #960): the revision bump is the capability
    invalidation and must carry the reserved `adopt:` namespace with
    `ON CONFLICT DO NOTHING` so a concurrent bump is a no-op."""
    connection = AsyncMock()
    transaction = MagicMock()
    connection.transaction = MagicMock(return_value=transaction)
    acquire = MagicMock()
    acquire.__aenter__ = AsyncMock(return_value=connection)
    pool.acquire = MagicMock(return_value=acquire)
    connection.fetch = AsyncMock(return_value=[{"id": "s-a"}])
    connection.fetchrow = AsyncMock(return_value={"session_id": "s-a"})

    await repo.adopt_ownership("anon_" + "a" * 32, "user-1")

    bump_sql = connection.fetchrow.await_args.args[0]
    assert "MAX(revision)" in bump_sql
    assert "ON CONFLICT (session_id, revision) DO NOTHING" in bump_sql
    assert connection.fetchrow.await_args.args[1] == "s-a"
    assert connection.fetchrow.await_args.args[2].startswith("adopt:")
