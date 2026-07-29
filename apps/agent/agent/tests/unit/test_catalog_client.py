"""Unit tests for the Catalog service client skeleton.

Response envelopes mirror packages/contract:
  search -> {rows, synced_at}, spots -> {point, distance_m?}, nearby -> {rows},
  ingest -> {status, version?, point_count?, reason?}.
"""

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx

from agent.clients.catalog_client import (
    CatalogClient,
    GeocodeCandidate,
    GeocodeKind,
    GeocodeSource,
    IngestResult,
    PilgrimagePoint,
    Route,
)

_POINT = {
    "id": "p1",
    "name": "Uji Bridge",
    "latitude": 34.89,
    "longitude": 135.80,
    "city": "Uji",
}


def test_geocode_types_remain_reexported() -> None:
    assert GeocodeCandidate.__module__ == "agent.clients.geocode"
    assert GeocodeKind.__module__ == "agent.clients.geocode"
    assert GeocodeSource.__module__ == "agent.clients.geocode"


@asynccontextmanager
async def _mock_catalog(
    json_payload: object,
) -> AsyncIterator[tuple[CatalogClient, list[httpx.Request]]]:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=json_payload)

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = CatalogClient("https://catalog.test", http_client=http_client)
    try:
        yield client, requests
    finally:
        await client.aclose()


async def test_search_parses_rows() -> None:
    """search() reads the {rows, synced_at} envelope into PilgrimagePoint models."""
    payload = {"rows": [_POINT], "synced_at": "2026-06-21T00:00:00Z"}
    async with _mock_catalog(payload) as (client, _):
        points = await client.search("響け")

    assert points == [
        PilgrimagePoint(
            id="p1", name="Uji Bridge", latitude=34.89, longitude=135.80, city="Uji"
        )
    ]


async def test_search_posts_query_to_catalog_path() -> None:
    """search() POSTs {query} to /catalog/search."""
    async with _mock_catalog({"rows": [], "synced_at": ""}) as (client, requests):
        await client.search("響け")

    assert str(requests[0].url) == "https://catalog.test/catalog/search"
    assert json.loads(requests[0].content) == {"query": "響け"}


async def test_spots_parses_single_point() -> None:
    """spots() reads the {point, distance_m?} envelope into one PilgrimagePoint."""
    async with _mock_catalog({"point": _POINT, "distance_m": 120.0}) as (client, _):
        point = await client.spots("115908")

    assert point == PilgrimagePoint(
        id="p1", name="Uji Bridge", latitude=34.89, longitude=135.80, city="Uji"
    )


async def test_nearby_parses_rows() -> None:
    """nearby() reads the {rows} envelope and POSTs lat/lng/radius_m."""
    async with _mock_catalog({"rows": [_POINT]}) as (client, requests):
        points = await client.nearby(34.89, 135.80, radius_m=500)

    assert len(points) == 1
    assert points[0].city == "Uji"
    assert json.loads(requests[0].content) == {
        "lat": 34.89,
        "lng": 135.80,
        "radius_m": 500,
    }


async def test_geocode_parses_candidates_and_posts_limit() -> None:
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
    async with _mock_catalog({"candidates": [candidate]}) as (client, requests):
        result = await client.geocode("西宮", limit=3)

    assert result == [GeocodeCandidate.model_validate(candidate)]
    assert result[0].kind == GeocodeKind.STATION
    assert result[0].source == GeocodeSource.MANUAL
    assert result[0].effective_radius_m == 10_000
    assert str(requests[0].url) == "https://catalog.test/catalog/geocode"
    assert json.loads(requests[0].content) == {"query": "西宮", "limit": 3}


async def test_route_parses_route() -> None:
    """route() validates the Route envelope and POSTs point_ids."""
    payload = {"ordered_points": [_POINT], "point_count": 1}
    async with _mock_catalog(payload) as (client, requests):
        route = await client.route(["p1"])

    assert isinstance(route, Route)
    assert route.point_count == 1
    assert json.loads(requests[0].content) == {"point_ids": ["p1"]}


async def test_route_posts_coordinate_origin() -> None:
    """route() sends origin only when coordinates are provided."""
    payload = {"ordered_points": [_POINT], "point_count": 1}
    async with _mock_catalog(payload) as (client, requests):
        await client.route(["p1"], origin=(34.89, 135.8))

    assert json.loads(requests[0].content) == {
        "point_ids": ["p1"],
        "origin": {"lat": 34.89, "lng": 135.8},
    }


async def test_ingest_parses_ingested() -> None:
    """ingest() reads the {status, version, point_count} envelope when ingested."""
    payload = {"status": "ingested", "version": 3, "point_count": 7}
    async with _mock_catalog(payload) as (client, _):
        result = await client.ingest("10380")

    assert result == IngestResult(status="ingested", version=3, point_count=7)


async def test_ingest_posts_bangumi_id_to_catalog_path() -> None:
    """ingest() POSTs {bangumi_id} to /catalog/ingest."""
    async with _mock_catalog({"status": "in_progress"}) as (client, requests):
        await client.ingest("10380")

    assert str(requests[0].url) == "https://catalog.test/catalog/ingest"
    assert json.loads(requests[0].content) == {"bangumi_id": "10380"}


async def test_ingest_parses_empty_with_reason() -> None:
    """ingest() carries the reason for a non-ingested status (empty/failed)."""
    async with _mock_catalog({"status": "empty", "reason": "no points"}) as (client, _):
        result = await client.ingest("999")

    assert result.status == "empty"
    assert result.reason == "no points"
