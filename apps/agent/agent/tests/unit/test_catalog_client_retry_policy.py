"""CatalogClient retry classifier, transport failures, and backoff."""

from __future__ import annotations

from collections.abc import Callable
from unittest.mock import AsyncMock

import httpx
import pytest

from agent.clients.catalog_client import CatalogClient
from agent.clients.errors import APIError

Handler = Callable[[httpx.Request], httpx.Response]


def _response(request: httpx.Request, status: int, payload: object) -> httpx.Response:
    return httpx.Response(status, request=request, json=payload)


def _install_transport(monkeypatch: pytest.MonkeyPatch, handler: Handler) -> None:
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "agent.clients.catalog_client.httpx.AsyncHTTPTransport",
        lambda **_kwargs: transport,
    )


def _no_sleep(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    sleep = AsyncMock()
    monkeypatch.setattr("agent.clients.catalog_client.asyncio.sleep", sleep)
    return sleep


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
    result = await CatalogClient("https://catalog.test/tenant-404").points_by_work_id(
        "8000"
    )

    assert result.rows == []
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
    result = await CatalogClient("https://catalog.test").points_by_work_id("8000")

    assert result.rows == []
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
        await CatalogClient("https://catalog.test", max_retries=3).points_by_work_id(
            "8000"
        )

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
        await CatalogClient("https://catalog.test", max_retries=8).points_by_work_id(
            "8000"
        )

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
