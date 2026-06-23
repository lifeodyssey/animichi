"""Unit tests for tools.py helper functions (split for coverage)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.tools import (
    _candidate_from_row,
    _catalog_fallback,
    _catalog_search,
    _db_lookup,
    _minimal_candidate,
    _write_through,
    enrich_clarify_candidates,
)
from agent.clients.catalog_client import CatalogClientProtocol, PilgrimagePoint
from agent.tests.eval.mock_catalog_client import MockCatalogClient


async def test_db_lookup_returns_empty_when_no_repo() -> None:
    deps = RuntimeDeps(
        db=MagicMock(spec=[]), locale="zh", query="q", catalog=MockCatalogClient()
    )
    result = await _db_lookup(deps, ["test"])
    assert result == {}


async def test_db_lookup_returns_empty_on_db_error() -> None:
    db = MagicMock()
    db.bangumi.find_candidate_details_by_titles = AsyncMock(
        side_effect=OSError("connection lost")
    )
    deps = RuntimeDeps(db=db, locale="zh", query="q", catalog=MockCatalogClient())
    result = await _db_lookup(deps, ["test"])
    assert result == {}


async def test_db_lookup_skips_non_dict_rows() -> None:
    db = MagicMock()
    db.bangumi.find_candidate_details_by_titles = AsyncMock(
        return_value=["not_a_dict", {"title": "好", "bangumi_id": "1"}]
    )
    deps = RuntimeDeps(db=db, locale="zh", query="q", catalog=MockCatalogClient())
    result = await _db_lookup(deps, ["好"])
    assert "好" in result


def test_candidate_from_row_with_full_data() -> None:
    row = {
        "cover_url": "https://example.com/img.jpg",
        "points_count": 5,
        "city": "京都",
    }
    c = _candidate_from_row("響け", row)
    assert c["title"] == "響け"
    assert c["cover_url"] == "https://example.com/img.jpg"
    assert c["spot_count"] == 5
    assert c["city"] == "京都"


def test_candidate_from_row_with_empty_data() -> None:
    c = _candidate_from_row("test", {})
    assert c["cover_url"] is None
    assert c["spot_count"] == 0
    assert c["city"] == ""


class _FailingCatalog:
    """A CatalogClientProtocol double whose search raises (transient failure)."""

    async def search(self, query: str) -> list[PilgrimagePoint]:
        raise OSError("catalog unreachable")

    async def spots(self, bangumi_id: str) -> PilgrimagePoint:
        raise OSError("catalog unreachable")

    async def nearby(
        self, lat: float, lng: float, *, radius_m: int = 2000
    ) -> list[PilgrimagePoint]:
        raise OSError("catalog unreachable")

    async def route(self, point_ids: list[str]) -> object:
        raise OSError("catalog unreachable")

    async def ingest(self, bangumi_id: str) -> object:
        raise OSError("catalog unreachable")


def test_minimal_candidate_shape() -> None:
    c = _minimal_candidate("test")
    assert c == {"title": "test", "cover_url": None, "spot_count": 0, "city": ""}


async def test_catalog_search_returns_empty_on_error() -> None:
    catalog: CatalogClientProtocol = _FailingCatalog()
    deps = RuntimeDeps(db=MagicMock(), locale="zh", query="q", catalog=catalog)
    result = await _catalog_search(deps, "test")
    assert result == []


async def test_catalog_fallback_returns_minimal_on_error() -> None:
    catalog: CatalogClientProtocol = _FailingCatalog()
    deps = RuntimeDeps(db=MagicMock(spec=[]), locale="zh", query="q", catalog=catalog)
    result = await _catalog_fallback(deps, "test")
    assert result["title"] == "test"
    assert result["cover_url"] is None
    assert result["spot_count"] == 0


async def test_catalog_fallback_resolves_via_catalog() -> None:
    db = MagicMock()
    db.bangumi.upsert_bangumi_title = AsyncMock(return_value=None)
    db.bangumi.upsert_bangumi = AsyncMock(return_value=None)
    deps = RuntimeDeps(db=db, locale="zh", query="q", catalog=MockCatalogClient())
    result = await _catalog_fallback(deps, "你的名字")
    assert result["cover_url"] == "https://example.test/cover/160209.jpg"
    assert result["spot_count"] == 2
    db.bangumi.upsert_bangumi_title.assert_awaited_once_with("你的名字", "160209")


async def test_write_through_logs_on_upsert_error() -> None:
    db = MagicMock()
    db.bangumi.upsert_bangumi_title = AsyncMock(side_effect=RuntimeError("fail"))
    db.bangumi.upsert_bangumi = AsyncMock()
    deps = RuntimeDeps(db=db, locale="zh", query="q", catalog=MockCatalogClient())
    await _write_through(deps, "test", "123", "https://img.example.com/x.jpg")
    db.bangumi.upsert_bangumi_title.assert_awaited_once()


async def test_enrich_empty_titles_returns_empty() -> None:
    deps = RuntimeDeps(
        db=MagicMock(), locale="zh", query="q", catalog=MockCatalogClient()
    )
    result = await enrich_clarify_candidates(deps, [])
    assert result == []
