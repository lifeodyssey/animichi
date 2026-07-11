"""Proof-of-concept eval against a MOCK catalog client (no DB / no network).

In the hybrid architecture the agent's tools will call the Catalog service via
``CatalogClient`` (search / spots / nearby / route) rather than touching the DB
or Anitabi directly. This module proves that the agent's data layer can be
exercised against a deterministic in-memory ``MockCatalogClient``: fast, offline,
and seeded so resolvable cases return data and unknown ones return empty.

Scope (deliberately small — NOT the full 617-case suite): ~5 representative
cases covering search (ja/zh/en), nearby, route, and an unknown-title miss.

WIRING STATUS (W2-A1, landed):
    The data-tool -> CatalogClient seam now exists: ``run_pilgrimage_agent`` accepts
    a ``catalog`` client and the four data tools route through it (see
    ``agent.agents.pilgrimage_tools``). This module validates the mock contract +
    the catalog data layer directly; the LIVE agent run driven against this mock
    lives in ``test_agent_eval_mock_runtime.py``.
"""

from __future__ import annotations

import pytest

from agent.clients.catalog_client import CatalogClient, PilgrimagePoint, Route
from agent.tests.eval.mock_catalog_client import MockCatalogClient

# ── Representative eval-style cases (mirror agent_eval_v3 ids) ─────────


# (case_id, query, expected_bangumi_id_or_None)
_SEARCH_CASES = [
    ("A1_ja_001", "君の名は。の聖地を教えて", "160209"),
    ("A1_zh_001", "你的名字的圣地在哪里", "160209"),
    ("A1_en_001", "Where are the Your Name pilgrimage spots?", "160209"),
    ("A4_ja_001", "魔法少女マジカルドリーマーの聖地", None),  # unknown -> empty
]


def test_mock_implements_catalog_client_interface() -> None:
    """MockCatalogClient is structurally substitutable for CatalogClient."""
    for method in ("search", "spots", "nearby", "route"):
        assert callable(getattr(MockCatalogClient, method)), method
        assert hasattr(CatalogClient, method), method


@pytest.mark.parametrize(("case_id", "query", "expected_id"), _SEARCH_CASES)
async def test_search_cases_return_typed_points(
    case_id: str, query: str, expected_id: str | None
) -> None:
    """search() yields typed points for resolvable cases, empty for misses."""
    client = MockCatalogClient()
    points = await client.search(query)
    assert all(isinstance(p, PilgrimagePoint) for p in points), case_id
    if expected_id is None:
        assert points == [], case_id
    else:
        assert points, case_id
        assert all(p.bangumi_id == expected_id for p in points), case_id
        assert all(p.latitude and p.longitude for p in points), case_id


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
    """Unknown title/coord/ids mirror the DataCompleteness empty baseline."""
    client = MockCatalogClient()
    assert await client.search("存在しないアニメ") == []
    assert await client.nearby(0.0, 0.0, radius_m=1000) == []
    assert (await client.route(["does-not-exist"])).point_count == 0


async def test_spots_returns_point_for_known_work() -> None:
    """spots() returns a seeded point for a resolvable work."""
    point = await MockCatalogClient().spots("160209")
    assert isinstance(point, PilgrimagePoint)


async def test_spots_raises_for_unknown_work() -> None:
    """spots() raises APIError for an unknown work, like the real client."""
    from agent.clients.errors import APIError

    with pytest.raises(APIError):
        await MockCatalogClient().spots("000000")


async def test_calls_are_recorded_and_offline() -> None:
    """The mock records calls and performs no real DB/network access."""
    client = MockCatalogClient()
    await client.search("君の名は。")
    await client.route(["p001", "p002"])
    assert [name for name, _ in client.calls] == ["search", "route"]
