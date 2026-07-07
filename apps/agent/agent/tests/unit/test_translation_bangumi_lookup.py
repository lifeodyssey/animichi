"""Unit tests for the httpx-backed Bangumi title lookup."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from agent.agents.translation_bangumi import lookup_bangumi_api

_SEARCH_PAYLOAD = {
    "data": [{"name": "君の名は。", "name_cn": "你的名字。"}],
}


def _install_httpx(
    monkeypatch: pytest.MonkeyPatch,
    *,
    status_code: int = 200,
    payload: object = None,
    error: Exception | None = None,
) -> AsyncMock:
    response = MagicMock()
    response.status_code = status_code
    response.json = MagicMock(return_value=payload)
    post = AsyncMock(return_value=response, side_effect=error)
    client = MagicMock()
    client.post = post
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(
        "agent.agents.translation_bangumi.httpx.AsyncClient",
        MagicMock(return_value=client),
    )
    return post


async def test_returns_chinese_name(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_httpx(monkeypatch, payload=_SEARCH_PAYLOAD)

    result = await lookup_bangumi_api("君の名は", "zh")

    assert result == "你的名字。"


async def test_returns_japanese_name(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_httpx(monkeypatch, payload=_SEARCH_PAYLOAD)

    result = await lookup_bangumi_api("你的名字", "ja")

    assert result == "君の名は。"


async def test_returns_ascii_name_cn_for_english(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = {"data": [{"name": "ヴァイオレット", "name_cn": "Violet Evergarden"}]}
    _install_httpx(monkeypatch, payload=payload)

    result = await lookup_bangumi_api("ヴァイオレット", "en")

    assert result == "Violet Evergarden"


async def test_returns_none_for_non_ascii_name_cn_in_english(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_httpx(monkeypatch, payload=_SEARCH_PAYLOAD)

    result = await lookup_bangumi_api("君の名は", "en")

    assert result is None


async def test_posts_search_body_to_bangumi_api(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    post = _install_httpx(monkeypatch, payload=_SEARCH_PAYLOAD)

    await lookup_bangumi_api("君の名は", "zh")

    url = post.call_args.args[0]
    assert url == "https://api.bgm.tv/v0/search/subjects"
    assert post.call_args.kwargs["json"] == {
        "keyword": "君の名は",
        "filter": {"type": [2]},
        "limit": 5,
    }


async def test_returns_none_on_http_error_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_httpx(monkeypatch, status_code=503, payload={})

    result = await lookup_bangumi_api("君の名は", "zh")

    assert result is None


async def test_returns_none_on_transport_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_httpx(monkeypatch, error=httpx.ConnectError("boom"))

    result = await lookup_bangumi_api("君の名は", "zh")

    assert result is None


async def test_returns_none_when_no_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_httpx(monkeypatch, payload={"data": []})

    result = await lookup_bangumi_api("unknown_anime_xyz", "zh")

    assert result is None
