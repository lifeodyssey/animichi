"""Unit tests for RoutesRepository."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.infrastructure.supabase.repositories.routes import RoutesRepository


@pytest.fixture
def pool() -> MagicMock:
    result = MagicMock()
    connection = MagicMock()
    connection.fetchrow = AsyncMock()
    connection.executemany = AsyncMock()
    result.fetch = AsyncMock()
    result.acquire.return_value.__aenter__.return_value = connection
    result.connection = connection
    return result


@pytest.fixture
def repo(pool: MagicMock) -> RoutesRepository:
    return RoutesRepository(pool)


async def test_save_route_returns_route_id(
    repo: RoutesRepository, pool: MagicMock
) -> None:
    pool.connection.fetchrow.return_value = {"id": "route-uuid-789"}
    result = await repo.save_route(
        session_id="sess-1",
        anime_ids=["115908", "117696"],
        point_ids=["p1", "p2", "p3"],
        route_data={"steps": [{"from": "p1", "to": "p2"}]},
        origin_station="Uji Station",
        origin_lat=34.88,
        origin_lon=135.80,
        total_distance=5200.0,
        total_duration=3600,
    )
    assert result == "route-uuid-789"
    pool.connection.fetchrow.assert_awaited_once()
    pool.connection.executemany.assert_awaited_once()
    sql = pool.connection.fetchrow.await_args.args[0]
    assert "INSERT INTO routes" in sql
    assert "RETURNING id" in sql
    assert "ST_MakePoint" in sql
    rows = pool.connection.executemany.await_args.args[1]
    assert rows == [
        ("route-uuid-789", "115908", 0),
        ("route-uuid-789", "117696", 1),
    ]


async def test_save_route_without_origin(
    repo: RoutesRepository, pool: MagicMock
) -> None:
    pool.connection.fetchrow.return_value = {"id": "route-uuid-abc"}
    result = await repo.save_route(
        session_id="sess-1",
        anime_ids=[],
        point_ids=["p1"],
        route_data={},
    )
    assert result == "route-uuid-abc"
    sql = pool.connection.fetchrow.await_args.args[0]
    # Single CASE WHEN statement handles both paths
    assert "CASE WHEN" in sql
    # origin_lon ($4) and origin_lat ($5) are passed as None
    args = pool.connection.fetchrow.await_args.args
    assert args[3] is None  # origin_lon
    assert args[4] is None  # origin_lat
    pool.connection.executemany.assert_not_awaited()


async def test_save_route_raises_when_no_row(
    repo: RoutesRepository, pool: MagicMock
) -> None:
    pool.connection.fetchrow.return_value = None
    with pytest.raises(RuntimeError, match="save_route"):
        await repo.save_route(
            session_id="sess-1",
            anime_ids=["115908"],
            point_ids=["p1"],
            route_data={},
        )


async def test_get_user_routes_returns_list(
    repo: RoutesRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [
        {
            "id": "r1",
            "anime_ids": ["115908", "117696"],
            "anime_titles": ["Liz", "K-On!"],
            "point_count": 3,
            "created_at": "2026-01-01",
            "origin_station": None,
        }
    ]
    result = await repo.get_user_routes("user-1", limit=5)
    assert len(result) == 1
    assert result[0]["anime_ids"] == ["115908", "117696"]
    sql = pool.fetch.await_args.args[0]
    assert "FROM route_anime" in sql
    assert "COALESCE(anime.anime_ids" in sql
