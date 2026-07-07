"""Unit tests: CatalogClient parses oRPC error envelopes into typed errors.

Sibling of test_catalog_client_http.py (kept separate to respect the
200-line file cap). Asserts the retry contract: user_actionable codes raise
immediately (one request), retryable codes flow through the backoff loop.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.clients.catalog_client import CatalogClient
from agent.clients.catalog_errors import (
    RouteTooManyClustersError,
    UpstreamUnavailableError,
    WorkNotFoundError,
)
from agent.clients.errors import TransientAPIError


def _response(status_code: int, payload: object) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.json = MagicMock(return_value=payload)
    return response


def _non_json_response(status_code: int) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.json = MagicMock(side_effect=ValueError("not json"))
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


def _envelope(code: str, data: object, status: int) -> dict[str, object]:
    return {
        "defined": True,
        "code": code,
        "status": status,
        "message": "wire text",
        "data": data,
    }


async def test_user_actionable_error_raises_without_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A defined 422 ROUTE_TOO_MANY_CLUSTERS raises typed, after ONE request."""
    _no_sleep(monkeypatch)
    body = _envelope(
        "ROUTE_TOO_MANY_CLUSTERS", {"cluster_count": 62, "max_clusters": 50}, 422
    )
    post = AsyncMock(return_value=_response(422, body))
    _install_client(monkeypatch, post)
    client = CatalogClient("https://catalog.test")

    with pytest.raises(RouteTooManyClustersError) as excinfo:
        await client.route([f"p{i}" for i in range(3)])

    assert post.call_count == 1
    assert excinfo.value.cluster_count == 62


async def test_retryable_envelope_is_retried_then_typed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A defined 502 UPSTREAM_UNAVAILABLE flows through the retry loop."""
    _no_sleep(monkeypatch)
    body = _envelope("UPSTREAM_UNAVAILABLE", {"upstream": "bangumi"}, 502)
    post = AsyncMock(return_value=_response(502, body))
    _install_client(monkeypatch, post)
    client = CatalogClient("https://catalog.test")

    with pytest.raises(UpstreamUnavailableError) as excinfo:
        await client.search("氷菓")

    assert post.call_count == 3
    assert excinfo.value.upstream == "bangumi"


async def test_retryable_envelope_then_success_recovers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One 502 envelope followed by a 200 succeeds via retry."""
    _no_sleep(monkeypatch)
    body = _envelope("UPSTREAM_UNAVAILABLE", {"upstream": "anitabi"}, 502)
    post = AsyncMock(
        side_effect=[
            _response(502, body),
            _response(200, {"rows": [], "synced_at": ""}),
        ]
    )
    _install_client(monkeypatch, post)
    client = CatalogClient("https://catalog.test")

    rows = await client.search("氷菓")

    assert rows == []
    assert post.call_count == 2


async def test_non_json_5xx_keeps_legacy_transient_behavior(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 500 with a non-JSON body still classifies as TransientAPIError."""
    _no_sleep(monkeypatch)
    post = AsyncMock(return_value=_non_json_response(500))
    _install_client(monkeypatch, post)
    client = CatalogClient("https://catalog.test")

    with pytest.raises(TransientAPIError):
        await client.search("氷菓")

    assert post.call_count == 3


async def test_work_not_found_raises_typed_on_spots(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A defined 404 WORK_NOT_FOUND surfaces the typed exception."""
    _no_sleep(monkeypatch)
    body = _envelope("WORK_NOT_FOUND", {"bangumi_id": "8000"}, 404)
    post = AsyncMock(return_value=_response(404, body))
    _install_client(monkeypatch, post)
    client = CatalogClient("https://catalog.test")

    with pytest.raises(WorkNotFoundError) as excinfo:
        await client.spots("8000")

    assert post.call_count == 1
    assert excinfo.value.bangumi_id == "8000"
