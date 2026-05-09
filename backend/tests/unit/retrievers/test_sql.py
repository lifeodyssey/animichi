"""Unit tests for SQL retrieval: execute_sql_with_fallback (API-first, DB-fallback)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.models import RetrievalRequest
from backend.agents.retrievers.sql import (
    execute_sql_with_fallback,
    should_try_api,
)
from backend.agents.sql_agent import SQLResult
from backend.domain.entities import Coordinates, Point


def _make_req(**kwargs: object) -> RetrievalRequest:
    return RetrievalRequest(tool="search_bangumi", **kwargs)  # type: ignore[arg-type]


def _make_sql_result(
    *,
    rows: list[dict] | None = None,
    error: str | None = None,
) -> SQLResult:
    r = rows or []
    return SQLResult(query="SELECT 1", params=[], rows=r, row_count=len(r), error=error)


def _make_point(point_id: str = "p1") -> Point:
    return Point(
        id=point_id,
        name="宇治桥",
        cn_name="宇治桥",
        coordinates=Coordinates(latitude=34.8843, longitude=135.7997),
        bangumi_id="115908",
        bangumi_title="響け！ユーフォニアム",
        episode=1,
        time_seconds=42,
    )


# ── should_try_api ──


class TestShouldTryApi:
    def test_true_for_search_bangumi_with_id(self) -> None:
        req = _make_req(bangumi_id="115908")
        assert should_try_api(req) is True

    def test_false_without_bangumi_id(self) -> None:
        req = _make_req()
        assert should_try_api(req) is False

    def test_false_for_search_nearby(self) -> None:
        req = RetrievalRequest(tool="search_nearby", bangumi_id="115908")
        assert should_try_api(req) is False


# ── execute_sql_with_fallback (API-first) ──


class TestExecuteSqlWithFallback:
    @pytest.mark.asyncio
    async def test_non_bangumi_tool_queries_db_directly(self) -> None:
        """Non-bangumi tools (e.g. search_nearby) skip API, go straight to DB."""
        sql_agent = MagicMock()
        sql_agent.execute = AsyncMock(
            return_value=_make_sql_result(rows=[{"id": "p1"}])
        )
        req = RetrievalRequest(tool="search_nearby")
        result, meta = await execute_sql_with_fallback(
            req, sql_agent, MagicMock(), None, None
        )
        assert result.row_count == 1
        assert meta["data_origin"] == "db"

    @pytest.mark.asyncio
    async def test_always_calls_api_first_for_bangumi(self) -> None:
        """search_bangumi always fetches from API before querying DB."""
        db = MagicMock()
        db.upsert_points_batch = AsyncMock()
        db.upsert_bangumi = AsyncMock()
        pool = AsyncMock()
        pool.execute = AsyncMock()
        db.pool = pool

        sql_agent = MagicMock()
        sql_agent.execute = AsyncMock(
            return_value=_make_sql_result(rows=[{"id": "p1"}, {"id": "p2"}])
        )
        fetch_bangumi_points = AsyncMock(
            return_value=[_make_point(), _make_point("p2")]
        )
        get_bangumi_subject = AsyncMock(return_value={"name": "Test"})

        req = _make_req(bangumi_id="115908")
        with patch(
            "backend.agents.retrievers.enrichment.fetch_bangumi_lite",
            new=AsyncMock(return_value=None),
        ):
            result, meta = await execute_sql_with_fallback(
                req,
                sql_agent,
                db,
                fetch_bangumi_points,
                get_bangumi_subject,
            )

        # API was called
        fetch_bangumi_points.assert_awaited_once_with("115908")
        # DB was queried after API write-through
        sql_agent.execute.assert_awaited_once()
        assert result.row_count == 2
        assert meta["data_origin"] == "api"

    @pytest.mark.asyncio
    async def test_falls_back_to_db_when_api_fails(self) -> None:
        """If API fetch fails, still queries DB (cached data)."""
        sql_agent = MagicMock()
        sql_agent.execute = AsyncMock(
            return_value=_make_sql_result(rows=[{"id": "p1"}])
        )
        fetch_bangumi_points = AsyncMock(side_effect=OSError("API unreachable"))

        req = _make_req(bangumi_id="115908")
        result, meta = await execute_sql_with_fallback(
            req,
            sql_agent,
            MagicMock(),
            fetch_bangumi_points,
            None,
        )

        assert result.row_count == 1
        assert meta["data_origin"] == "db"

    @pytest.mark.asyncio
    async def test_falls_back_to_db_when_no_fetch_fn(self) -> None:
        """If fetch_bangumi_points is None, queries DB directly."""
        sql_agent = MagicMock()
        sql_agent.execute = AsyncMock(
            return_value=_make_sql_result(rows=[{"id": "p1"}])
        )

        req = _make_req(bangumi_id="115908")
        result, meta = await execute_sql_with_fallback(
            req,
            sql_agent,
            MagicMock(),
            None,
            None,
        )

        assert result.row_count == 1
        assert meta["data_origin"] == "db"

    @pytest.mark.asyncio
    async def test_raises_if_bangumi_id_none(self) -> None:
        req = RetrievalRequest(tool="search_bangumi")
        # should_try_api returns False -> goes to DB path
        sql_agent = MagicMock()
        sql_agent.execute = AsyncMock(return_value=_make_sql_result())
        result, meta = await execute_sql_with_fallback(
            req,
            sql_agent,
            MagicMock(),
            None,
            None,
        )
        assert result.row_count == 0
        assert meta["data_origin"] == "db"
