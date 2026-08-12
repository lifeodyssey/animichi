"""Unit tests for FinalSessionRepository — ordered message history.

The session-history surfaces of the sole Session aggregate repository:
`insert_message`, `get_messages`, `current_revision`, and `history` (owned
page + revision) against the fresh-schema manifest. No conversation root.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

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
