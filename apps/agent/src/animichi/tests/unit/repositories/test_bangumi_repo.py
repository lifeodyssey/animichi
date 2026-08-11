"""Unit tests for BangumiRepository."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from animichi.infrastructure.supabase.repositories.bangumi import BangumiRepository


@pytest.fixture
def pool() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def repo(pool: AsyncMock) -> BangumiRepository:
    return BangumiRepository(pool)


async def test_get_bangumi_returns_row_when_exists(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"id": "115908", "title": "Liz and the Blue Bird"}
    result = await repo.get_bangumi("115908")
    assert result is not None
    assert result["id"] == "115908"
    assert result["title"] == "Liz and the Blue Bird"
    pool.fetchrow.assert_awaited_once_with(
        "SELECT * FROM bangumi WHERE id = $1", "115908"
    )


async def test_get_bangumi_returns_none_when_not_found(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    result = await repo.get_bangumi("nonexistent")
    assert result is None


async def test_get_bangumi_raises_on_pool_error(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.side_effect = RuntimeError("connection lost")
    with pytest.raises(RuntimeError, match="connection lost"):
        await repo.get_bangumi("115908")


async def test_filter_existing_ids_preserves_input_order(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [{"id": "3"}, {"id": "1"}]
    result = await repo.filter_existing_ids(["1", "missing", "3"])
    assert result == ["1", "3"]
    pool.fetch.assert_awaited_once_with(
        "SELECT id FROM bangumi WHERE id = ANY($1::text[])",
        ["1", "missing", "3"],
    )


async def test_list_bangumi_returns_list(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [
        {"id": "1", "title": "A", "rating": 9.0},
        {"id": "2", "title": "B", "rating": 8.0},
    ]
    result = await repo.list_bangumi(limit=10)
    assert len(result) == 2
    pool.fetch.assert_awaited_once()


async def test_find_bangumi_by_title_returns_id(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"id": "115908"}
    result = await repo.find_bangumi_by_title("Liz")
    assert result == "115908"


async def test_find_bangumi_by_title_returns_none(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    result = await repo.find_bangumi_by_title("nonexistent")
    assert result is None


async def test_get_bangumi_by_area_returns_dicts(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [
        {"bangumi_id": "1", "bangumi_title": "A", "city": "Kyoto"}
    ]
    result = await repo.get_bangumi_by_area(34.88, 135.80)
    assert len(result) == 1
    assert result[0]["city"] == "Kyoto"


async def test_get_bangumi_by_area_includes_cover_url_and_points_count(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    """get_bangumi_by_area rows now include cover_url, title_cn, points_count."""
    pool.fetch.return_value = [
        {
            "bangumi_id": "115908",
            "bangumi_title": "Liz and the Blue Bird",
            "city": "Kyoto",
            "cover_url": "https://example.com/cover.jpg",
            "title_cn": "利兹与青鸟",
            "points_count": 5,
        }
    ]
    result = await repo.get_bangumi_by_area(34.88, 135.80)
    assert len(result) == 1
    row = result[0]
    assert row["cover_url"] == "https://example.com/cover.jpg"
    assert row["title_cn"] == "利兹与青鸟"
    assert row["points_count"] == 5


async def test_get_bangumi_by_area_sql_selects_extended_columns(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    """SQL query must select cover_url, title_cn, points_count."""
    pool.fetch.return_value = []
    await repo.get_bangumi_by_area(34.88, 135.80)
    sql = pool.fetch.await_args.args[0]
    assert "cover_url" in sql
    assert "title_cn" in sql
    assert "points_count" in sql


async def test_get_bangumi_by_area_returns_empty_when_no_points_in_radius(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    """Returns empty list when nothing is within radius."""
    pool.fetch.return_value = []
    result = await repo.get_bangumi_by_area(0.0, 0.0, radius_m=1000)
    assert result == []


async def test_find_candidate_details_by_titles_returns_cover_city_points(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [
        {
            "title": "凉宫春日的忧郁",
            "bangumi_id": "253",
            "cover_url": "https://example.com/cover.jpg",
            "city": "西宫",
            "points_count": 3,
        }
    ]
    rows = await repo.find_candidate_details_by_titles(["凉宫春日的忧郁"])
    assert rows[0]["title"] == "凉宫春日的忧郁"
    assert "cover_url" in rows[0]
    assert "city" in rows[0]
    assert "points_count" in rows[0]
