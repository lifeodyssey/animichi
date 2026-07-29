"""Phase 1c pins for typed Catalog endpoint and route invariants."""

import json

import pytest
from pydantic import ValidationError

from agent.clients.catalog_client import (
    PilgrimagePoint,
    ResolveResolved,
    Route,
    SearchResult,
)
from agent.tests.unit.test_catalog_client import _mock_catalog

_POINT = {"id": "p1", "name": "Uji Bridge", "latitude": 34.89, "longitude": 135.8}


async def test_resolve_posts_to_typed_phase1a_endpoint() -> None:
    payload = {
        "outcome": "resolved",
        "match": {"bangumi_id": "115908", "title": "響け！ユーフォニアム"},
    }
    async with _mock_catalog(payload) as (client, requests):
        result = await client.resolve("京吹")
    assert isinstance(result, ResolveResolved)
    assert str(requests[0].url) == "https://catalog.test/catalog/resolve"
    assert json.loads(requests[0].content) == {"query": "京吹"}


async def test_points_by_work_id_never_repeats_free_text_search() -> None:
    async with _mock_catalog({"rows": [_POINT], "synced_at": "now"}) as (
        client,
        requests,
    ):
        result = await client.points_by_work_id("115908")
    assert result == SearchResult(
        rows=[PilgrimagePoint.model_validate(_POINT)], synced_at="now"
    )
    assert str(requests[0].url).endswith("/catalog/points-by-work-id")
    assert json.loads(requests[0].content) == {"work_id": "115908"}


def test_route_rejects_count_without_matching_ordered_points() -> None:
    with pytest.raises(ValidationError, match="point_count must match"):
        Route(point_count=1)
