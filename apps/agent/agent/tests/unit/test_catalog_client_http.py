"""Unit tests for CatalogClient's official retry transport and lifecycle."""

from __future__ import annotations

from collections.abc import Callable
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from agent.clients.catalog_client import CatalogClient
from agent.clients.errors import APIError

Handler = Callable[[httpx.Request], httpx.Response]


def _response(request: httpx.Request, status: int, payload: object) -> httpx.Response:
    return httpx.Response(status, request=request, json=payload)


def _install_transport(monkeypatch: pytest.MonkeyPatch, handler: Handler) -> MagicMock:
    constructor = MagicMock(return_value=httpx.MockTransport(handler))
    monkeypatch.setattr("pydantic_ai.retries.AsyncHTTPTransport", constructor)
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


async def test_status_in_url_does_not_defeat_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        payload = {} if attempts == 1 else {"rows": [], "synced_at": ""}
        return _response(request, 500 if attempts == 1 else 200, payload)

    _no_sleep(monkeypatch)
    _install_transport(monkeypatch, handler)
    points = await CatalogClient("https://catalog.test/tenant-404").search("響け")

    assert points == []
    assert attempts == 2


async def test_retries_on_transport_error(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise httpx.ConnectError("boom", request=request)
        return _response(request, 200, {"rows": [], "synced_at": ""})

    _no_sleep(monkeypatch)
    _install_transport(monkeypatch, handler)
    points = await CatalogClient("https://catalog.test").search("響け")

    assert points == []
    assert attempts == 2


async def test_exhaustion_pins_attempts_and_backoff(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return _response(request, 502, {})

    sleep = _no_sleep(monkeypatch)
    _install_transport(monkeypatch, handler)
    with pytest.raises(APIError, match="HTTP 502"):
        await CatalogClient("https://catalog.test", max_retries=3).search("響け")

    assert attempts == 3
    assert [call.args[0] for call in sleep.await_args_list] == [1.0, 2.0]


async def test_backoff_caps_at_thirty_seconds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return _response(request, 503, {})

    sleep = _no_sleep(monkeypatch)
    _install_transport(monkeypatch, handler)
    with pytest.raises(APIError, match="HTTP 503"):
        await CatalogClient("https://catalog.test", max_retries=8).search("響け")

    assert attempts == 8
    assert [call.args[0] for call in sleep.await_args_list] == [
        1.0,
        2.0,
        4.0,
        8.0,
        16.0,
        30.0,
        30.0,
    ]


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
