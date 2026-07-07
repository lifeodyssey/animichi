"""Unit tests for CatalogClient transport: shared client, retry, lifecycle."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from agent.clients.catalog_client import CatalogClient
from agent.clients.errors import APIError


def _response(status_code: int, payload: object) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.json = MagicMock(return_value=payload)
    return response


def _install_client(monkeypatch: pytest.MonkeyPatch, post: AsyncMock) -> MagicMock:
    client = MagicMock()
    client.post = post
    client.is_closed = False
    client.aclose = AsyncMock()
    constructor = MagicMock(return_value=client)
    monkeypatch.setattr("agent.clients.catalog_client.httpx.AsyncClient", constructor)
    return constructor


def _no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("agent.clients.catalog_client.asyncio.sleep", AsyncMock())


async def test_reuses_one_http_client_across_requests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two RPCs on the same CatalogClient share one httpx.AsyncClient."""
    post = AsyncMock(return_value=_response(200, {"rows": [], "synced_at": ""}))
    constructor = _install_client(monkeypatch, post)
    client = CatalogClient("https://catalog.test")

    await client.search("響け")
    await client.search("氷菓")

    assert constructor.call_count == 1, "AsyncClient must be created once"


async def test_retries_on_5xx_then_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 5xx response is retried; the eventual success is returned."""
    _no_sleep(monkeypatch)
    post = AsyncMock(
        side_effect=[
            _response(503, {}),
            _response(200, {"rows": [], "synced_at": ""}),
        ]
    )
    _install_client(monkeypatch, post)

    points = await CatalogClient("https://catalog.test").search("響け")

    assert points == []
    assert post.call_count == 2


async def test_retries_on_429_then_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 429 rate-limit response is retried, matching public_api transient set."""
    _no_sleep(monkeypatch)
    post = AsyncMock(
        side_effect=[
            _response(429, {}),
            _response(200, {"rows": [], "synced_at": ""}),
        ]
    )
    _install_client(monkeypatch, post)

    points = await CatalogClient("https://catalog.test").search("響け")

    assert points == []
    assert post.call_count == 2


async def test_does_not_retry_on_4xx(monkeypatch: pytest.MonkeyPatch) -> None:
    """A 4xx response raises immediately without retry."""
    _no_sleep(monkeypatch)
    post = AsyncMock(return_value=_response(404, {}))
    _install_client(monkeypatch, post)

    with pytest.raises(APIError, match="HTTP 404"):
        await CatalogClient("https://catalog.test").search("響け")
    assert post.call_count == 1


async def test_status_in_url_does_not_defeat_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Retry decisions use the status code, not substrings of the message."""
    _no_sleep(monkeypatch)
    post = AsyncMock(
        side_effect=[
            _response(500, {}),
            _response(200, {"rows": [], "synced_at": ""}),
        ]
    )
    _install_client(monkeypatch, post)

    # Old retry.py matched "404" anywhere in the error string; a URL like
    # this one made genuine 500s non-retryable.
    points = await CatalogClient("https://catalog.test/tenant-404").search("響け")

    assert points == []
    assert post.call_count == 2


async def test_retries_on_transport_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """httpx transport errors are treated as transient and retried."""
    _no_sleep(monkeypatch)
    post = AsyncMock(
        side_effect=[
            httpx.ConnectError("boom"),
            _response(200, {"rows": [], "synced_at": ""}),
        ]
    )
    _install_client(monkeypatch, post)

    points = await CatalogClient("https://catalog.test").search("響け")

    assert points == []
    assert post.call_count == 2


async def test_raises_after_retries_exhausted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Persistent 5xx exhausts max_retries attempts, then raises."""
    _no_sleep(monkeypatch)
    post = AsyncMock(return_value=_response(502, {}))
    _install_client(monkeypatch, post)

    with pytest.raises(APIError, match="HTTP 502"):
        await CatalogClient("https://catalog.test", max_retries=3).search("響け")
    assert post.call_count == 3


async def test_aclose_closes_shared_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """aclose() closes the underlying httpx client."""
    post = AsyncMock(return_value=_response(200, {"rows": [], "synced_at": ""}))
    constructor = _install_client(monkeypatch, post)
    client = CatalogClient("https://catalog.test")
    await client.search("響け")

    await client.aclose()

    constructor.return_value.aclose.assert_awaited_once()


async def test_aclose_without_requests_is_noop() -> None:
    """aclose() on a never-used client does not create a connection."""
    client = CatalogClient("https://catalog.test")

    await client.aclose()
