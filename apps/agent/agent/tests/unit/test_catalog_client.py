import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx

from agent.clients.catalog_client import (
    CatalogClient,
    GeocodeCandidate,
    GeocodeKind,
    GeocodeSource,
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
