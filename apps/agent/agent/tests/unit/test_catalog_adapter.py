"""Unit tests for the catalog payload adapter.

The adapter converts typed Catalog models (PilgrimagePoint / Route) into the
named tool-result models the response builder and output_validator expect
(mirroring the legacy handler payloads), so swapping the data source is
invisible to the rest of the agent.
"""

from __future__ import annotations

import pytest

from agent.agents.catalog_adapter import (
    build_resolve_payload,
    build_route_payload,
    build_search_payload,
)
from agent.agents.handlers._helpers import (
    _build_nearby_groups,
    rewrite_image_urls,
)
from agent.agents.tool_results import (
    ResolveAnimeResult,
    RouteToolResult,
    SearchToolResult,
)
from agent.clients.catalog_client import PilgrimagePoint, Route
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def _point(pid: str = "p1", bangumi_id: str = "160209") -> PilgrimagePoint:
    return PilgrimagePoint(
        id=pid,
        name="須賀神社",
        name_cn="须贺神社",
        bangumi_id=bangumi_id,
        latitude=35.71,
        longitude=139.72,
        title="君の名は。",
        title_cn="你的名字",
        cover_url="https://example.test/c.jpg",
    )


def test_build_search_payload_returns_search_tool_result() -> None:
    payload = build_search_payload([_point(), _point("p2")], tool="search_bangumi")
    assert isinstance(payload, SearchToolResult)


def test_build_search_payload_has_rows_and_row_count() -> None:
    payload = build_search_payload([_point(), _point("p2")], tool="search_bangumi")
    assert payload.row_count == 2
    assert len(payload.rows) == 2


def test_build_search_payload_status_ok_when_points() -> None:
    payload = build_search_payload([_point()], tool="search_bangumi")
    assert payload.status == "ok"


def test_build_search_payload_status_empty_when_no_points() -> None:
    payload = build_search_payload([], tool="search_bangumi")
    assert payload.status == "empty"


def test_build_search_payload_sets_anime_title_metadata() -> None:
    payload = build_search_payload([_point()], tool="search_bangumi")
    assert payload.metadata.anime_title == "君の名は。"


def test_build_search_payload_builds_nearby_groups() -> None:
    payload = build_search_payload([_point()], tool="search_nearby")
    assert payload.nearby_groups[0].bangumi_id == "160209"


def test_build_resolve_payload_returns_resolve_anime_result() -> None:
    payload = build_resolve_payload([_point()])
    assert isinstance(payload, ResolveAnimeResult)


def test_build_resolve_payload_single_match_returns_bangumi_id() -> None:
    payload = build_resolve_payload([_point()])
    assert payload.bangumi_id == "160209"
    assert payload.title == "君の名は。"


def test_build_resolve_payload_includes_candidates() -> None:
    payload = build_resolve_payload([_point()])
    assert payload.candidates[0].bangumi_id == "160209"


def test_build_resolve_payload_multiple_works_is_ambiguous() -> None:
    payload = build_resolve_payload([_point("p1", "160209"), _point("p2", "100403")])
    assert payload.ambiguous is True
    assert len(payload.candidates) == 2


def test_build_resolve_payload_empty_when_no_points() -> None:
    payload = build_resolve_payload([])
    assert payload.candidates == []


async def test_build_route_payload_returns_route_tool_result() -> None:
    route: Route = await MockCatalogClient().route(["p_euph_1", "p_euph_2"])
    payload = build_route_payload(route)
    assert isinstance(payload, RouteToolResult)


async def test_build_route_payload_from_catalog_route() -> None:
    route: Route = await MockCatalogClient().route(["p_euph_1", "p_euph_2"])
    payload = build_route_payload(route)
    assert payload.point_count == 2
    assert payload.status == "ok"
    assert payload.timed_itinerary.spot_count == 2


async def test_build_route_payload_summary_has_coordinate_counts() -> None:
    route: Route = await MockCatalogClient().route(["p_euph_1", "p_euph_2"])
    summary = build_route_payload(route).summary
    assert summary.with_coordinates == 2
    assert summary.without_coordinates == 0


def test_build_route_payload_empty_route_has_zero_points() -> None:
    payload = build_route_payload(Route())
    assert payload.point_count == 0


# ---------------------------------------------------------------------------
# shared shaping helpers (_helpers) — live, consumed by the adapter
# ---------------------------------------------------------------------------


def test_rewrite_image_urls_keeps_originals_in_development(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "development")
    rows = [{"screenshot_url": "https://image.anitabi.cn/s/x.jpg"}]
    assert rewrite_image_urls(rows)[0]["screenshot_url"].startswith("https://")


def test_rewrite_image_urls_proxies_anitabi_cdn_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    rows = [{"screenshot_url": "https://image.anitabi.cn/s/x.jpg"}]
    assert rewrite_image_urls(rows)[0]["screenshot_url"] == "/img/s/x.jpg"


def test_rewrite_image_urls_proxies_relative_screenshot_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    rows = [{"screenshot_url": "screenshot/y.jpg"}]
    assert rewrite_image_urls(rows)[0]["screenshot_url"] == "/img/screenshot/y.jpg"


def test_rewrite_image_urls_skips_rows_without_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    rows = [{"screenshot_url": ""}, {"name": "no url key"}]
    out = rewrite_image_urls(rows)
    assert out[0]["screenshot_url"] == ""
    assert "screenshot_url" not in out[1]


def test_build_nearby_groups_aggregates_same_bangumi_id() -> None:
    rows = [
        {"bangumi_id": "1", "title": "A", "cover_url": "c.jpg", "distance_m": 300},
        {"bangumi_id": "1", "title_cn": "甲", "distance_m": 100},
    ]
    groups = _build_nearby_groups(rows)
    assert len(groups) == 1
    assert groups[0]["points_count"] == 2
    assert groups[0]["closest_distance_m"] == pytest.approx(100.0)
    assert groups[0]["cover_url"] == "c.jpg"


def test_build_nearby_groups_uses_title_cn_fallback() -> None:
    rows = [{"bangumi_id": "1", "title_cn": "甲"}]
    assert _build_nearby_groups(rows)[0]["title"] == "甲"


def test_build_nearby_groups_skips_rows_without_bangumi_id() -> None:
    rows = [{"title": "no id"}, {"bangumi_id": ""}]
    assert _build_nearby_groups(rows) == []
