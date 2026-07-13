"""Unit tests for the Catalog service client skeleton.

Response envelopes mirror packages/contract:
  search -> {rows, synced_at}, spots -> {point, distance_m?}, nearby -> {rows},
  ingest -> {status, version?, point_count?, reason?}.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.clients.catalog_client import (
    CatalogClient,
    GeocodeCandidate,
    GeocodeKind,
    GeocodeSource,
    IngestResult,
    PilgrimagePoint,
    Route,
)

_POINT = {"id": "p1", "name": "Uji Bridge", "latitude": 34.89, "longitude": 135.80}


def test_geocode_types_remain_reexported() -> None:
    assert GeocodeCandidate.__module__ == "agent.clients.geocode"
    assert GeocodeKind.__module__ == "agent.clients.geocode"
    assert GeocodeSource.__module__ == "agent.clients.geocode"


def _mock_httpx(monkeypatch: pytest.MonkeyPatch, json_payload: object) -> MagicMock:
    """Patch ``httpx.AsyncClient`` so POST returns ``json_payload``."""
    response = MagicMock()
    response.status_code = 200
    response.json = MagicMock(return_value=json_payload)

    client = MagicMock()
    client.post = AsyncMock(return_value=response)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)

    monkeypatch.setattr(
        "agent.clients.catalog_client.httpx.AsyncClient",
        MagicMock(return_value=client),
    )
    return client


async def test_search_parses_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    """search() reads the {rows, synced_at} envelope into PilgrimagePoint models."""
    _mock_httpx(monkeypatch, {"rows": [_POINT], "synced_at": "2026-06-21T00:00:00Z"})

    points = await CatalogClient("https://catalog.test").search("響け")

    assert points == [
        PilgrimagePoint(id="p1", name="Uji Bridge", latitude=34.89, longitude=135.80)
    ]


async def test_search_posts_query_to_catalog_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """search() POSTs {query} to /catalog/search."""
    client = _mock_httpx(monkeypatch, {"rows": [], "synced_at": ""})

    await CatalogClient("https://catalog.test").search("響け")

    url, kwargs = client.post.call_args.args[0], client.post.call_args.kwargs
    assert url == "https://catalog.test/catalog/search"
    assert kwargs["json"] == {"query": "響け"}


async def test_spots_parses_single_point(monkeypatch: pytest.MonkeyPatch) -> None:
    """spots() reads the {point, distance_m?} envelope into one PilgrimagePoint."""
    _mock_httpx(monkeypatch, {"point": _POINT, "distance_m": 120.0})

    point = await CatalogClient("https://catalog.test").spots("115908")

    assert point == PilgrimagePoint(
        id="p1", name="Uji Bridge", latitude=34.89, longitude=135.80
    )


async def test_nearby_parses_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    """nearby() reads the {rows} envelope and POSTs lat/lng/radius_m."""
    client = _mock_httpx(monkeypatch, {"rows": [_POINT]})

    points = await CatalogClient("https://catalog.test").nearby(
        34.89, 135.80, radius_m=500
    )

    assert len(points) == 1
    assert client.post.call_args.kwargs["json"] == {
        "lat": 34.89,
        "lng": 135.80,
        "radius_m": 500,
    }


async def test_geocode_parses_candidates_and_posts_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    candidate = {
        "id": "seed:nishinomiya",
        "label": "西宮駅(兵庫県)",
        "name": "西宮駅",
        "lat": 34.7386,
        "lng": 135.3485,
        "kind": "station",
        "source": "manual",
        "effective_radius_m": 10000,
    }
    client = _mock_httpx(monkeypatch, {"candidates": [candidate]})

    result = await CatalogClient("https://catalog.test").geocode("西宮", limit=3)

    assert result == [GeocodeCandidate.model_validate(candidate)]
    assert result[0].kind == GeocodeKind.STATION
    assert result[0].source == GeocodeSource.MANUAL
    assert result[0].effective_radius_m == 10_000
    assert client.post.call_args.args[0] == "https://catalog.test/catalog/geocode"
    assert client.post.call_args.kwargs["json"] == {"query": "西宮", "limit": 3}


async def test_route_parses_route(monkeypatch: pytest.MonkeyPatch) -> None:
    """route() validates the Route envelope and POSTs point_ids."""
    client = _mock_httpx(monkeypatch, {"ordered_points": [_POINT], "point_count": 1})

    route = await CatalogClient("https://catalog.test").route(["p1"])

    assert isinstance(route, Route)
    assert route.point_count == 1
    assert client.post.call_args.kwargs["json"] == {"point_ids": ["p1"]}


async def test_route_posts_coordinate_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    """route() sends origin only when coordinates are provided."""
    client = _mock_httpx(monkeypatch, {"ordered_points": [_POINT], "point_count": 1})

    await CatalogClient("https://catalog.test").route(["p1"], origin=(34.89, 135.8))

    assert client.post.call_args.kwargs["json"] == {
        "point_ids": ["p1"],
        "origin": {"lat": 34.89, "lng": 135.8},
    }


async def test_ingest_parses_ingested(monkeypatch: pytest.MonkeyPatch) -> None:
    """ingest() reads the {status, version, point_count} envelope when ingested."""
    _mock_httpx(monkeypatch, {"status": "ingested", "version": 3, "point_count": 7})

    result = await CatalogClient("https://catalog.test").ingest("10380")

    assert result == IngestResult(status="ingested", version=3, point_count=7)


async def test_ingest_posts_bangumi_id_to_catalog_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ingest() POSTs {bangumi_id} to /catalog/ingest."""
    client = _mock_httpx(monkeypatch, {"status": "in_progress"})

    await CatalogClient("https://catalog.test").ingest("10380")

    url, kwargs = client.post.call_args.args[0], client.post.call_args.kwargs
    assert url == "https://catalog.test/catalog/ingest"
    assert kwargs["json"] == {"bangumi_id": "10380"}


async def test_ingest_parses_empty_with_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ingest() carries the reason for a non-ingested status (empty/failed)."""
    _mock_httpx(monkeypatch, {"status": "empty", "reason": "no points"})

    result = await CatalogClient("https://catalog.test").ingest("999")

    assert result.status == "empty"
    assert result.reason == "no points"
