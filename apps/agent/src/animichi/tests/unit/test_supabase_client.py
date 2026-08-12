"""Unit tests for SupabaseClient repository property delegation."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from animichi.infrastructure.supabase.client import SupabaseClient


@pytest.fixture
def mock_pool() -> AsyncMock:
    pool = AsyncMock()
    pool.fetchrow = AsyncMock()
    pool.execute = AsyncMock()
    return pool


def _make_client(pool: AsyncMock) -> SupabaseClient:
    """Create a SupabaseClient with repos initialized from a mock pool."""
    client = SupabaseClient.__new__(SupabaseClient)
    client._pool = pool
    client._bangumi = None
    client._points = None
    client._session = None
    client._feedback = None
    client._init_repos(pool)
    return client


@pytest.mark.asyncio
async def test_search_points_by_location_uses_runtime_contract_query() -> None:
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    client = _make_client(pool)

    await client.points.search_points_by_location(34.8843, 135.7997, 5000, limit=10)

    sql = pool.fetch.await_args.args[0]

    assert "ST_DWithin" in sql
    assert "points" in sql
    assert "SELECT *" not in sql
    assert "LEFT JOIN bangumi b ON p.bangumi_id = b.id" in sql
    assert "p.image AS screenshot_url" in sql
    assert "b.title" in sql
    assert "b.title_cn" in sql
    assert "distance_m" in sql


@pytest.mark.asyncio
async def test_constructor_initializes_repository_slots() -> None:
    client = SupabaseClient("postgresql://test:test@localhost:5432/test")

    assert client._session is None
    assert client._feedback is None
    assert client._pool is None


class TestFindBangumiByTitle:
    async def test_exact_title_match(self, mock_pool):
        mock_pool.fetchrow.return_value = {"id": "115908"}
        client = _make_client(mock_pool)
        result = await client.bangumi.find_bangumi_by_title("響け！ユーフォニアム")
        assert result == "115908"
        call_args = mock_pool.fetchrow.call_args[0]
        assert "ilike" in call_args[0].lower() or "$1" in call_args[0]

    async def test_no_match_returns_none(self, mock_pool):
        mock_pool.fetchrow.return_value = None
        client = _make_client(mock_pool)
        result = await client.bangumi.find_bangumi_by_title("unknown anime xyz")
        assert result is None


class TestGetPointsByIds:
    async def test_returns_empty_for_empty_input(self, mock_pool):
        client = _make_client(mock_pool)

        result = await client.points.get_points_by_ids([])

        assert result == []
        mock_pool.fetch.assert_not_awaited()

    async def test_fetches_points_preserving_input_order(self, mock_pool):
        mock_pool.fetch.return_value = [
            {"id": "p2", "name": "Byodoin"},
            {"id": "p1", "name": "Uji Bridge"},
        ]
        client = _make_client(mock_pool)

        result = await client.points.get_points_by_ids(["p2", "p1"])

        assert result == [
            {"id": "p2", "name": "Byodoin"},
            {"id": "p1", "name": "Uji Bridge"},
        ]
        sql = mock_pool.fetch.await_args.args[0]
        assert "WITH ORDINALITY" in sql


@pytest.fixture
def persistence_db(mock_pool: AsyncMock) -> SupabaseClient:
    return _make_client(mock_pool)


class TestUpsertSession:
    async def test_inserts_or_touches_session(self, persistence_db, mock_pool):
        await persistence_db.session.upsert_session(
            session_id="sess-1",
            user_id="user-1",
            state={"context": {"bangumi_id": "115908"}},
        )

        sql = mock_pool.execute.await_args.args[0]
        assert "INSERT INTO sessions" in sql
        assert "ON CONFLICT" in sql
        assert "user_id = COALESCE(EXCLUDED.user_id, sessions.user_id)" in sql

    async def test_does_not_overwrite_existing_first_query(
        self,
        persistence_db,
        mock_pool,
    ):
        await persistence_db.session.upsert_session(
            session_id="sess-1",
            user_id="user-1",
            state={"context": {"bangumi_id": "115908"}},
        )

        sql = mock_pool.execute.await_args.args[0]
        assert "first_query" not in sql.split("DO UPDATE SET", maxsplit=1)[1]


class TestUpdateTitle:
    async def test_updates_session_title(self, persistence_db, mock_pool):
        await persistence_db.session.update_title(
            "sess-1", "京吹 宇治", user_id="user-1"
        )

        sql = mock_pool.fetchrow.await_args.args[0]
        assert "UPDATE sessions" in sql
        assert "title" in sql


class TestListSessions:
    async def test_returns_empty_list_when_no_rows(self, persistence_db, mock_pool):
        mock_pool.fetch.return_value = []

        result = await persistence_db.session.list_sessions("user-1")

        assert result == []

    async def test_returns_list_of_dicts(self, persistence_db, mock_pool):
        mock_pool.fetch.return_value = [
            {
                "session_id": "sess-1",
                "title": "京吹の聖地",
                "first_query": "京吹の聖地を探して",
                "created_at": "2026-04-02T10:00:00Z",
                "updated_at": "2026-04-02T10:00:00Z",
            }
        ]

        result = await persistence_db.session.list_sessions("user-1")

        assert len(result) == 1
        assert result[0]["session_id"] == "sess-1"
