from __future__ import annotations

from agent.clients.catalog_client import PilgrimagePoint, Route
from agent.tests.eval.mock_catalog_client import MockCatalogClient


async def test_nearby_returns_sorted_points_within_radius() -> None:
    """nearby() (E2/A2-style geo query) returns distance-tagged, sorted points."""
    client = MockCatalogClient()
    points = await client.near_location("宇治")
    assert points, "Uji should resolve to seeded Euphonium points"
    assert all(isinstance(p, PilgrimagePoint) for p in points)
    distances = [p.distance_m for p in points]
    assert distances == sorted(distances)
    assert all(d >= 0 for d in distances)


async def test_route_builds_valid_timed_itinerary() -> None:
    """route() (D1-style plan) returns an ordered Route with a timed itinerary."""
    client = MockCatalogClient()
    route = await client.route(["p004", "p005"])
    assert isinstance(route, Route)
    assert route.point_count == 2
    assert len(route.ordered_points) == 2
    itinerary = route.timed_itinerary
    assert itinerary.spot_count == 2
    assert len(itinerary.stops) == 2
    assert len(itinerary.legs) == 1
    assert itinerary.total_minutes > 0


async def test_unknown_inputs_yield_no_data() -> None:
    """Unknown title/coord/ids keep DataKeysPresent empty-data semantics stable."""
    client = MockCatalogClient()
    assert await client.nearby(0.0, 0.0, radius_m=1000) == []
    assert (await client.route(["does-not-exist"])).point_count == 0
