"""Unit tests for bangumi data routes.

Covers: GET /v1/bangumi/nearby.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

from animichi.tests.unit.conftest_fastapi import (
    async_client,
    build_app,
    build_stub_db,
)


def _build_stub_db_with_bangumi() -> AsyncMock:
    db = build_stub_db()
    db.bangumi.get_bangumi_by_area = AsyncMock(return_value=[])
    return db


async def test_nearby_returns_200_with_bangumi_array() -> None:
    db = build_stub_db()
    db.bangumi.get_bangumi_by_area = AsyncMock(
        return_value=[
            {
                "bangumi_id": "115908",
                "bangumi_title": "Liz and the Blue Bird",
                "city": "Kyoto",
                "cover_url": "https://example.com/cover.jpg",
                "title_cn": "利兹与青鸟",
                "points_count": 3,
            }
        ]
    )
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get("/v1/bangumi/nearby?lat=34.9&lng=135.8&radius_m=50000")

    assert resp.status_code == 200
    body = resp.json()
    assert "bangumi" in body
    item = body["bangumi"][0]
    assert item["bangumi_id"] == "115908"
    assert item["points_count"] == 3


async def test_nearby_empty_returns_empty_array() -> None:
    db = build_stub_db()
    db.bangumi.get_bangumi_by_area = AsyncMock(return_value=[])
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get("/v1/bangumi/nearby?lat=0.0&lng=0.0&radius_m=1000")
    assert resp.status_code == 200
    assert resp.json() == {"bangumi": []}


async def test_nearby_lat_out_of_range_returns_422() -> None:
    db = build_stub_db()
    db.bangumi.get_bangumi_by_area = AsyncMock(return_value=[])
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get("/v1/bangumi/nearby?lat=91.0&lng=135.8&radius_m=50000")
    assert resp.status_code == 422


async def test_nearby_missing_lat_returns_422() -> None:
    db = build_stub_db()
    db.bangumi.get_bangumi_by_area = AsyncMock(return_value=[])
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get("/v1/bangumi/nearby?lng=135.8&radius_m=50000")
    assert resp.status_code == 422


async def test_nearby_without_auth_header_still_returns_200() -> None:
    db = build_stub_db()
    db.bangumi.get_bangumi_by_area = AsyncMock(return_value=[])
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get("/v1/bangumi/nearby?lat=35.0&lng=135.0&radius_m=1000")
    assert resp.status_code == 200


async def test_nearby_with_x_user_id_header_passes_auth_context() -> None:
    db = build_stub_db()
    db.bangumi.get_bangumi_by_area = AsyncMock(return_value=[])
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get(
            "/v1/bangumi/nearby?lat=35.0&lng=135.0&radius_m=1000",
            headers={"X-User-Id": "user-1"},
        )
    assert resp.status_code == 200


async def test_nearby_zero_radius_returns_422() -> None:
    db = build_stub_db()
    db.bangumi.get_bangumi_by_area = AsyncMock(return_value=[])
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get("/v1/bangumi/nearby?lat=35.0&lng=135.0&radius_m=0")
    assert resp.status_code == 422
    assert "radius_m" in resp.json()["error"]["message"]


async def test_nearby_negative_radius_returns_422() -> None:
    db = build_stub_db()
    db.bangumi.get_bangumi_by_area = AsyncMock(return_value=[])
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get("/v1/bangumi/nearby?lat=35.0&lng=135.0&radius_m=-1000")
    assert resp.status_code == 422
    assert "radius_m" in resp.json()["error"]["message"]


async def test_nearby_positive_radius_returns_200() -> None:
    db = build_stub_db()
    db.bangumi.get_bangumi_by_area = AsyncMock(return_value=[])
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get("/v1/bangumi/nearby?lat=35.0&lng=135.0&radius_m=1")
    assert resp.status_code == 200
