"""Unit tests for typed catalog-to-registry and wire adapters."""

from __future__ import annotations

import pytest

from animichi.agents.catalog_adapter import (
    build_itinerary_payload,
    build_itinerary_state,
    build_search_payload,
    build_search_state,
)
from animichi.agents.handlers.image_url_rewrite import rewrite_image_urls
from animichi.agents.handlers.nearby_groups import build_nearby_groups
from animichi.clients.catalog_client import Itinerary, Point
from animichi.tests.eval.mock_catalog_client import MockCatalogClient


def _point(
    pid: str = "p1", bangumi_id: str = "160209", city: str | None = None
) -> Point:
    return Point(
        id=pid,
        name="須賀神社",
        name_cn="须贺神社",
        bangumi_id=bangumi_id,
        latitude=35.71,
        longitude=139.72,
        title="君の名は。",
        title_cn="你的名字",
        cover_url="https://example.test/c.jpg",
        city=city,
    )


def test_build_search_payload_has_rows_and_row_count() -> None:
    payload = build_search_payload([_point(), _point("p2")], tool="search_bangumi")
    assert payload["row_count"] == 2
    assert len(payload["rows"]) == 2


def test_build_search_payload_status_ok_when_points() -> None:
    payload = build_search_payload([_point()], tool="search_bangumi")
    assert payload["status"] == "ok"


def test_build_search_payload_status_empty_when_no_points() -> None:
    payload = build_search_payload([], tool="search_bangumi")
    assert payload["status"] == "empty"


def test_build_search_payload_sets_anime_title_metadata() -> None:
    payload = build_search_payload([_point()], tool="search_bangumi")
    metadata = payload["metadata"]
    assert isinstance(metadata, dict)
    assert metadata["anime_title"] == "君の名は。"


def test_build_search_payload_builds_nearby_groups() -> None:
    payload = build_search_payload([_point()], tool="search_nearby")
    groups = payload["nearby_groups"]
    assert isinstance(groups, list)
    assert groups[0]["bangumi_id"] == "160209"


@pytest.mark.parametrize(
    ("locale", "city", "expected"),
    [("ja", "Uji", "宇治"), ("zh", "Tokyo", "东京")],
)
def test_search_state_localizes_catalog_city_at_trusted_boundary(
    locale: str, city: str, expected: str
) -> None:
    state = build_search_state([_point(city=city)], kind="bangumi", locale=locale)
    assert state.rows[0].city == expected


async def test_route_state_localizes_catalog_city_at_trusted_boundary() -> None:
    route = await MockCatalogClient().plan_itinerary(["p004"])
    route.ordered_points[0].city = "Tokyo"
    state = build_itinerary_state(route, source_ref=None, locale="ja")
    assert state.ordered_points[0].city == "東京"


async def test_build_itinerary_payload_from_catalog_itinerary() -> None:
    itinerary: Itinerary = await MockCatalogClient().plan_itinerary(["p004", "p005"])
    payload = build_itinerary_payload(itinerary)
    assert payload["point_count"] == 2
    assert payload["status"] == "ok"
    itinerary = payload["timed_itinerary"]
    assert isinstance(itinerary, dict)
    assert itinerary["spot_count"] == 2


async def test_build_itinerary_payload_summary_has_coordinate_counts() -> None:
    itinerary: Itinerary = await MockCatalogClient().plan_itinerary(["p004", "p005"])
    summary = build_itinerary_payload(itinerary)["summary"]
    assert isinstance(summary, dict)
    assert summary["with_coordinates"] == 2
    assert summary["without_coordinates"] == 0


def test_build_itinerary_payload_empty_itinerary_has_zero_points() -> None:
    payload = build_itinerary_payload(Itinerary())
    assert payload["point_count"] == 0


# ---------------------------------------------------------------------------
# shared shaping helpers (image_url_rewrite, nearby_groups) — live, consumed
# by the adapter
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


def test_http_anitabi_urls_are_rewritten_not_left_as_mixed_content(monkeypatch):
    """An http:// origin used to pass the substring test yet dodge the
    https-only replace, shipping a mixed-content URL (#1222 review)."""
    monkeypatch.setenv("APP_ENV", "production")
    rows = [{"screenshot_url": "http://image.anitabi.cn/s/x.jpg"}]
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
    groups = build_nearby_groups(rows)
    assert len(groups) == 1
    assert groups[0].points_count == 2
    assert groups[0].closest_distance_m == pytest.approx(100.0)
    assert groups[0].cover_url == "c.jpg"


def test_build_nearby_groups_uses_title_cn_fallback() -> None:
    rows = [{"bangumi_id": "1", "title_cn": "甲"}]
    assert build_nearby_groups(rows)[0].title == "甲"


def test_build_nearby_groups_skips_rows_without_bangumi_id() -> None:
    rows = [{"title": "no id"}, {"bangumi_id": ""}]
    assert build_nearby_groups(rows) == []
