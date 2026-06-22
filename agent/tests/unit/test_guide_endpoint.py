"""Unit tests for GET /v1/bangumi/{bangumi_id}/guide endpoint."""

from __future__ import annotations

from unittest.mock import AsyncMock

from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db


def _bangumi_row(
    bangumi_id: str = "485",
    title: str = "Hibike! Euphonium",
    title_cn: str = "吹响！悠风号",
    cover_url: str = "https://img.example.com/485.jpg",
    city: str = "宇治市",
) -> dict[str, object]:
    return {
        "id": bangumi_id,
        "title": title,
        "title_cn": title_cn,
        "cover_url": cover_url,
        "city": city,
    }


def _point_row(
    point_id: str = "p1",
    name: str = "宇治橋",
    *,
    latitude: float = 34.8892,
    longitude: float = 135.8002,
    image: str = "https://image.anitabi.cn/p1.jpg",
    episode: int = 1,
    time_seconds: int = 120,
) -> dict[str, object]:
    return {
        "id": point_id,
        "name": name,
        "name_cn": None,
        "latitude": latitude,
        "longitude": longitude,
        "image": image,
        "episode": episode,
        "time_seconds": time_seconds,
        "bangumi_id": "485",
    }


# ---- AC 1: Valid bangumi_id returns 200 with guide data ----


async def test_guide_valid_bangumi_returns_200() -> None:
    mock_db = build_stub_db()
    mock_db.bangumi.get_bangumi = AsyncMock(return_value=_bangumi_row())
    mock_db.points.get_points_by_bangumi = AsyncMock(
        return_value=[_point_row("p1", "宇治橋"), _point_row("p2", "大吉山")]
    )
    app, _ = build_app(db=mock_db)

    async with async_client(app) as client:
        resp = await client.get("/v1/bangumi/485/guide")

    assert resp.status_code == 200
    body = resp.json()
    assert body["bangumi_id"] == "485"
    assert body["title"] == "Hibike! Euphonium"
    assert body["title_cn"] == "吹响！悠风号"
    assert body["spot_count"] == 2
    assert len(body["spots"]) == 2
    assert body["bounds"] is not None


# ---- AC 2: Unknown bangumi_id returns 404 ----


async def test_guide_unknown_bangumi_returns_404() -> None:
    mock_db = build_stub_db()
    mock_db.bangumi.get_bangumi = AsyncMock(return_value=None)
    app, _ = build_app(db=mock_db)

    async with async_client(app) as client:
        resp = await client.get("/v1/bangumi/99999/guide")

    assert resp.status_code == 404
    error = resp.json()["error"]
    assert error["code"] == "not_found"
    assert error["message"] == "Bangumi not found."


# ---- AC 3: Bangumi with 0 spots returns 200 with empty spots ----


async def test_guide_zero_spots_returns_empty() -> None:
    mock_db = build_stub_db()
    mock_db.bangumi.get_bangumi = AsyncMock(return_value=_bangumi_row())
    mock_db.points.get_points_by_bangumi = AsyncMock(return_value=[])
    app, _ = build_app(db=mock_db)

    async with async_client(app) as client:
        resp = await client.get("/v1/bangumi/485/guide")

    assert resp.status_code == 200
    body = resp.json()
    assert body["spots"] == []
    assert body["spot_count"] == 0
    assert body["bounds"] is None


# ---- AC 4: Bounds computed correctly ----


async def test_guide_bounds_computed_correctly() -> None:
    mock_db = build_stub_db()
    mock_db.bangumi.get_bangumi = AsyncMock(return_value=_bangumi_row())
    mock_db.points.get_points_by_bangumi = AsyncMock(
        return_value=[
            _point_row("p1", "A", latitude=35.0, longitude=135.0),
            _point_row("p2", "B", latitude=34.0, longitude=136.0),
            _point_row("p3", "C", latitude=36.0, longitude=134.0),
        ]
    )
    app, _ = build_app(db=mock_db)

    async with async_client(app) as client:
        resp = await client.get("/v1/bangumi/485/guide")

    bounds = resp.json()["bounds"]
    assert bounds["north"] == 36.0
    assert bounds["south"] == 34.0
    assert bounds["east"] == 136.0
    assert bounds["west"] == 134.0


# ---- AC 5: Spots include screenshot_url mapped from image ----


async def test_guide_spots_map_image_to_screenshot_url() -> None:
    mock_db = build_stub_db()
    mock_db.bangumi.get_bangumi = AsyncMock(return_value=_bangumi_row())
    mock_db.points.get_points_by_bangumi = AsyncMock(
        return_value=[
            _point_row("p1", "宇治橋", image="https://image.anitabi.cn/p1.jpg"),
        ]
    )
    app, _ = build_app(db=mock_db)

    async with async_client(app) as client:
        resp = await client.get("/v1/bangumi/485/guide")

    spot = resp.json()["spots"][0]
    assert spot["screenshot_url"] == "https://image.anitabi.cn/p1.jpg"
    assert "image" not in spot
