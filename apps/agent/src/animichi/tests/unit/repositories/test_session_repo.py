"""Unit tests for FinalSessionRepository — aggregate core (SESSION-3 #961).

The sole Session aggregate repository's create/load/commit surfaces against
the fresh-schema manifest (`sessions` ownership + state). Message history and
adoption live in sibling test modules; no second root.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from animichi.infrastructure.supabase.repositories.session import (
    FinalSessionRepository,
    _as_state,
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


async def test_state_parser_accepts_mapping_rows() -> None:
    state = _as_state({"locale": "ja"})
    assert state == {"locale": "ja"}


async def test_state_parser_returns_none_for_scalars() -> None:
    assert _as_state(42) is None
