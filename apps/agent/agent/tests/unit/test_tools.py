"""Unit tests for agent.agents.tools."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.tools import enrich_clarify_candidates
from agent.tests.eval.mock_catalog_client import MockCatalogClient


async def test_enrich_clarify_candidates_keeps_order_and_defaults() -> None:
    db = MagicMock()
    db.bangumi = MagicMock()
    db.bangumi.find_candidate_details_by_titles = AsyncMock(
        return_value=[
            {
                "title": "凉宫春日的忧郁",
                "bangumi_id": "253",
                "cover_url": "https://example.com/a.jpg",
                "points_count": 12,
                "city": "西宫",
            },
            {
                "title": "凉宫春日的消失",
                "bangumi_id": "254",
                "cover_url": "",
                "points_count": 0,
                "city": "",
            },
        ]
    )
    deps = RuntimeDeps(db=db, locale="zh", query="q", catalog=MockCatalogClient())

    candidates = await enrich_clarify_candidates(
        deps, ["凉宫春日的忧郁", "凉宫春日的消失"]
    )

    assert [c["title"] for c in candidates] == ["凉宫春日的忧郁", "凉宫春日的消失"]
    assert candidates[0]["cover_url"] == "https://example.com/a.jpg"
    assert candidates[0]["spot_count"] == 12
    assert candidates[0]["city"] == "西宫"
    assert candidates[1]["cover_url"] is None
    assert candidates[1]["spot_count"] == 0


async def test_enrich_clarify_candidates_falls_back_to_catalog_and_writes_through() -> (
    None
):
    db = MagicMock()
    db.bangumi = MagicMock()
    db.bangumi.find_candidate_details_by_titles = AsyncMock(
        return_value=[
            {
                "title": "你的名字",
                "bangumi_id": None,
                "cover_url": "",
                "points_count": 0,
                "city": "",
            }
        ]
    )
    db.bangumi.upsert_bangumi_title = AsyncMock(return_value=None)
    db.bangumi.upsert_bangumi = AsyncMock(return_value=None)

    deps = RuntimeDeps(db=db, locale="zh", query="q", catalog=MockCatalogClient())

    candidates = await enrich_clarify_candidates(deps, ["你的名字"])

    # The catalog's first hit carries the bangumi_id (160209), cover, and the
    # work's point count — no Bangumi gateway is consulted.
    assert candidates[0]["cover_url"] == "https://example.test/cover/160209.jpg"
    assert candidates[0]["spot_count"] == 3
    db.bangumi.upsert_bangumi_title.assert_awaited_once_with("你的名字", "160209")
    db.bangumi.upsert_bangumi.assert_awaited()
