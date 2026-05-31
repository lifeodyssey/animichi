"""Unit tests for GET /v1/search/preview (anonymous search preview endpoint).

Covers: happy path, empty result, rate limit, missing q param, IP extraction.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db


def _make_db(
    *,
    bangumi_id: str | None = "bg-1",
    bangumi: dict | None = None,
    points: list | None = None,
) -> MagicMock:
    db = build_stub_db()
    db.bangumi.find_bangumi_by_title = AsyncMock(return_value=bangumi_id)
    db.bangumi.get_bangumi = AsyncMock(
        return_value=bangumi
        or {
            "title": "ゆるキャン△",
            "title_cn": "摇曳露营",
            "cover_url": "https://example.com/cover.jpg",
        }
    )
    db.points.get_points_by_bangumi = AsyncMock(
        return_value=points
        or [
            {
                "id": f"pt-{i}",
                "name": f"スポット{i}",
                "name_cn": None,
                "episode": 1,
                "time_seconds": 60 * i,
                "image": f"https://example.com/img{i}.jpg",
                "latitude": 35.3 + i * 0.01,
                "longitude": 138.7 + i * 0.01,
            }
            for i in range(1, 8)  # 7 points, more than PREVIEW_LIMIT=5
        ]
    )
    return db


@pytest.mark.asyncio
async def test_search_preview_returns_limited_results() -> None:
    db = _make_db()
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get(
            "/v1/search/preview",
            params={"q": "ゆるキャン"},
            headers={"X-User-Id": "anon", "CF-Connecting-IP": "1.2.3.4"},
        )
    assert resp.status_code == 200
    body = resp.json()
    results = body["results"]
    assert results["row_count"] == 5  # PREVIEW_LIMIT
    assert results["total_available"] == 7
    assert body["auth_required_for_full"] is True
    assert results["status"] == "ok"


@pytest.mark.asyncio
async def test_search_preview_includes_metadata() -> None:
    db = _make_db()
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get(
            "/v1/search/preview",
            params={"q": "ゆるキャン"},
            headers={"X-User-Id": "anon", "CF-Connecting-IP": "1.2.3.4"},
        )
    body = resp.json()
    assert body["results"].get("metadata", {}).get("anime_title") == "ゆるキャン△"


@pytest.mark.asyncio
async def test_search_preview_empty_when_not_found() -> None:
    db = _make_db(bangumi_id=None)
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get(
            "/v1/search/preview",
            params={"q": "存在しないアニメ"},
            headers={"CF-Connecting-IP": "1.2.3.4"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["results"]["row_count"] == 0
    assert body["results"]["status"] == "empty"
    assert body.get("auth_required_for_full") is False


@pytest.mark.asyncio
async def test_search_preview_rejects_empty_q() -> None:
    db = build_stub_db()
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get(
            "/v1/search/preview",
            params={"q": ""},
            headers={"CF-Connecting-IP": "1.2.3.4"},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_search_preview_rejects_missing_q() -> None:
    db = build_stub_db()
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get(
            "/v1/search/preview",
            headers={"CF-Connecting-IP": "1.2.3.4"},
        )
    # q defaults to "" → 422 from the endpoint logic
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_search_preview_rate_limit() -> None:
    """After RATE_LIMIT_CALLS requests from the same IP, return 429."""
    from backend.interfaces.routes import search_preview as sp_mod

    # Reset state for this IP
    test_ip = "10.99.99.1"
    sp_mod._ip_timestamps.pop(test_ip, None)

    db = _make_db()
    app, _ = build_app(db=db)

    async with async_client(app) as client:
        for _ in range(sp_mod.RATE_LIMIT_CALLS):
            r = await client.get(
                "/v1/search/preview",
                params={"q": "ゆるキャン"},
                headers={"CF-Connecting-IP": test_ip},
            )
            assert r.status_code == 200

        # 11th request should be rate-limited
        r = await client.get(
            "/v1/search/preview",
            params={"q": "ゆるキャン"},
            headers={"CF-Connecting-IP": test_ip},
        )
    assert r.status_code == 429
