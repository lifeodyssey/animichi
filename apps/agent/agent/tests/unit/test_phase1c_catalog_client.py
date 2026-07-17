"""Phase 1c pins for typed Catalog endpoint and route invariants."""

import pytest
from pydantic import ValidationError

from agent.clients.catalog_client import (
    CatalogClient,
    PilgrimagePoint,
    ResolveResolved,
    Route,
    SearchResult,
)
from agent.tests.unit.test_catalog_client import _mock_httpx

_POINT = {"id": "p1", "name": "Uji Bridge", "latitude": 34.89, "longitude": 135.8}


async def test_resolve_posts_to_typed_phase1a_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = {
        "outcome": "resolved",
        "match": {"bangumi_id": "115908", "title": "響け！ユーフォニアム"},
    }
    client = _mock_httpx(monkeypatch, payload)
    result = await CatalogClient("https://catalog.test").resolve("京吹")
    assert isinstance(result, ResolveResolved)
    assert client.post.call_args.args[0] == "https://catalog.test/catalog/resolve"
    assert client.post.call_args.kwargs["json"] == {"query": "京吹"}


async def test_points_by_work_id_never_repeats_free_text_search(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _mock_httpx(monkeypatch, {"rows": [_POINT], "synced_at": "now"})
    result = await CatalogClient("https://catalog.test").points_by_work_id("115908")
    assert result == SearchResult(
        rows=[PilgrimagePoint.model_validate(_POINT)], synced_at="now"
    )
    assert client.post.call_args.args[0].endswith("/catalog/points-by-work-id")
    assert client.post.call_args.kwargs["json"] == {"work_id": "115908"}


def test_route_rejects_count_without_matching_ordered_points() -> None:
    with pytest.raises(ValidationError, match="point_count must match"):
        Route(point_count=1)
