"""Unit tests for the scripts-local seed HTTP helpers (Bangumi + Anitabi)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.scripts.seed_http import fetch_points, fetch_subject, parse_points

_OFFICIAL_ITEM = {
    "id": "pt-1",
    "name": "宇治橋",
    "cn": "宇治桥",
    "geo": [34.889, 135.807],
    "image": "/images/pt-1.jpg",
    "ep": 3,
    "s": 120,
}

_LEGACY_ITEM = {
    "id": "pt-2",
    "name": "大吉山",
    "lat": 34.892,
    "lng": 135.812,
    "screenshot": "https://img.test/pt-2.jpg",
}


def _install_httpx(
    monkeypatch: pytest.MonkeyPatch, *, status_code: int = 200, payload: object = None
) -> AsyncMock:
    response = MagicMock()
    response.status_code = status_code
    response.json = MagicMock(return_value=payload)
    response.raise_for_status = MagicMock()
    get = AsyncMock(return_value=response)
    client = MagicMock()
    client.get = get
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(
        "agent.scripts.seed_http.httpx.AsyncClient",
        MagicMock(return_value=client),
    )
    return get


class TestParsePoints:
    def test_parses_official_geo_schema(self) -> None:
        points = parse_points([_OFFICIAL_ITEM], "115908")

        assert points[0].id == "pt-1"
        assert points[0].coordinates.latitude == pytest.approx(34.889)
        assert points[0].screenshot_url == "https://image.anitabi.cn/images/pt-1.jpg"

    def test_parses_legacy_lat_lng_schema(self) -> None:
        points = parse_points([_LEGACY_ITEM], "115908")

        assert points[0].id == "pt-2"
        assert points[0].coordinates.longitude == pytest.approx(135.812)

    def test_skips_items_missing_geo(self) -> None:
        points = parse_points([{"id": "bad", "name": "x"}, _OFFICIAL_ITEM], "115908")

        assert [p.id for p in points] == ["pt-1"]

    def test_sorts_by_episode_then_time(self) -> None:
        early = dict(_OFFICIAL_ITEM, id="pt-early", ep=1, s=10)
        points = parse_points([_OFFICIAL_ITEM, early], "115908")

        assert [p.id for p in points] == ["pt-early", "pt-1"]

    def test_unwraps_points_envelope(self) -> None:
        points = parse_points({"points": [_OFFICIAL_ITEM]}, "115908")

        assert len(points) == 1

    def test_returns_empty_for_empty_payload(self) -> None:
        assert parse_points([], "115908") == []
        assert parse_points(None, "115908") == []


class TestFetchSubject:
    async def test_returns_subject_dict(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _install_httpx(monkeypatch, payload={"name": "響け！ユーフォニアム"})

        subject = await fetch_subject(115908)

        assert subject["name"] == "響け！ユーフォニアム"

    async def test_gets_v0_subject_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        get = _install_httpx(monkeypatch, payload={})

        await fetch_subject(115908)

        assert get.call_args.args[0] == "https://api.bgm.tv/v0/subjects/115908"

    async def test_rejects_non_object_payload(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _install_httpx(monkeypatch, payload=[1, 2])

        with pytest.raises(ValueError, match="Unexpected subject payload"):
            await fetch_subject(115908)


class TestFetchPoints:
    async def test_returns_parsed_points(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _install_httpx(monkeypatch, payload=[_OFFICIAL_ITEM])

        points = await fetch_points("115908")

        assert [p.id for p in points] == ["pt-1"]

    async def test_requests_points_detail_with_image_filter(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        get = _install_httpx(monkeypatch, payload=[])

        await fetch_points("115908")

        assert get.call_args.args[0].endswith("/115908/points/detail")
        assert get.call_args.kwargs["params"] == {"haveImage": "true"}
