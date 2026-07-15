"""Unit tests for CatalogClient's official retry transport and lifecycle."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from agent.clients.catalog_client import CatalogClient
from agent.clients.catalog_errors import WorkNotFoundError
from agent.clients.errors import APIError, TransientAPIError

Handler = Callable[[httpx.Request], httpx.Response]


class _StreamingBody(httpx.AsyncByteStream):
    def __init__(self, payload: object) -> None:
        self._content = json.dumps(payload).encode()

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield self._content


def _response(request: httpx.Request, status: int, payload: object) -> httpx.Response:
    return httpx.Response(
        status,
        request=request,
        headers={"content-type": "application/json"},
        stream=_StreamingBody(payload),
    )


def _install_transport(monkeypatch: pytest.MonkeyPatch, handler: Handler) -> MagicMock:
    constructor = MagicMock(return_value=httpx.MockTransport(handler))
    monkeypatch.setattr(
        "agent.clients.catalog_client.httpx.AsyncHTTPTransport", constructor
    )
    return constructor


def _no_sleep(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    sleep = AsyncMock()
    monkeypatch.setattr("agent.clients.catalog_client.asyncio.sleep", sleep)
    return sleep


async def test_reuses_one_http_client_across_requests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return _response(request, 200, {"rows": [], "synced_at": ""})

    constructor = _install_transport(monkeypatch, handler)
    client = CatalogClient("https://catalog.test")
    await client.search("響け")
    await client.search("氷菓")

    assert constructor.call_count == 1
    assert len(calls) == 2
    await client.aclose()


@pytest.mark.parametrize("status", [408, 429, 500, 503])
async def test_retryable_status_then_success(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        payload = {} if attempts == 1 else {"rows": [], "synced_at": ""}
        return _response(request, status if attempts == 1 else 200, payload)

    sleep = _no_sleep(monkeypatch)
    _install_transport(monkeypatch, handler)
    points = await CatalogClient("https://catalog.test").search("響け")

    assert points == []
    assert attempts == 2
    sleep.assert_awaited_once_with(1.0)


async def test_does_not_retry_on_non_transient_4xx(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return _response(request, 404, {})

    sleep = _no_sleep(monkeypatch)
    _install_transport(monkeypatch, handler)
    with pytest.raises(APIError, match="HTTP 404"):
        await CatalogClient("https://catalog.test").search("響け")

    assert attempts == 1
    sleep.assert_not_awaited()


async def test_streaming_404_maps_buffered_server_envelope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = {
        "defined": True,
        "code": "WORK_NOT_FOUND",
        "status": 404,
        "message": "No catalog entry for this work",
        "data": {"bangumi_id": "8000"},
    }
    _install_transport(monkeypatch, lambda request: _response(request, 404, body))

    with pytest.raises(WorkNotFoundError, match="8000"):
        await CatalogClient("https://catalog.test").spots("8000")


async def test_streaming_503_retries_without_reading_transport_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return _response(request, 503, {"message": "temporarily unavailable"})

    _no_sleep(monkeypatch)
    _install_transport(monkeypatch, handler)

    with pytest.raises(TransientAPIError, match="HTTP 503"):
        await CatalogClient("https://catalog.test").search("響け")

    assert attempts == 3


def test_wrapped_transport_honors_https_proxy_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, request=request, json={})
    )
    constructor = MagicMock(return_value=transport)
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.test:8080")
    monkeypatch.setenv("https_proxy", "http://proxy.test:8080")
    monkeypatch.delenv("NO_PROXY", raising=False)
    monkeypatch.delenv("no_proxy", raising=False)
    monkeypatch.setattr(
        "agent.clients.catalog_client.httpx.AsyncHTTPTransport", constructor
    )

    CatalogClient("https://catalog.test")._http()

    assert constructor.call_args.kwargs == {
        "proxy": "http://proxy.test:8080",
        "trust_env": True,
    }


async def test_aclose_closes_shared_client(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return _response(request, 200, {"rows": [], "synced_at": ""})

    _install_transport(monkeypatch, handler)
    client = CatalogClient("https://catalog.test")
    await client.search("響け")
    shared = client._client

    await client.aclose()

    assert shared is not None and shared.is_closed
    assert client._client is None


async def test_aclose_without_requests_is_noop() -> None:
    client = CatalogClient("https://catalog.test")

    await client.aclose()

    assert client._client is None
