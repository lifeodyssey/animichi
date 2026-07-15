"""Unit tests: CatalogClient parses oRPC error envelopes into typed errors.

Sibling of test_catalog_client_http.py (kept separate to respect the
200-line file cap). Asserts the retry contract: user_actionable codes raise
immediately (one request), retryable codes flow through the backoff loop.
"""

from __future__ import annotations

import httpx
import pytest

from agent.clients.catalog_client import CatalogClient
from agent.clients.catalog_errors import (
    RouteTooManyClustersError,
    WorkNotFoundError,
)
from agent.clients.errors import TransientAPIError

ResponseSpec = tuple[int, object]


def _install_responses(
    monkeypatch: pytest.MonkeyPatch, specs: list[ResponseSpec]
) -> list[httpx.Request]:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        status, payload = specs.pop(0) if len(specs) > 1 else specs[0]
        if isinstance(payload, bytes):
            return httpx.Response(status, request=request, content=payload)
        return httpx.Response(status, request=request, json=payload)

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "agent.clients.catalog_client.httpx.AsyncHTTPTransport",
        lambda **_kwargs: transport,
    )
    return requests


async def _no_sleep(_delay: float) -> None:
    return None


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
    monkeypatch.setattr("agent.clients.catalog_client.asyncio.sleep", _no_sleep)
    body = _envelope(
        "ROUTE_TOO_MANY_CLUSTERS", {"cluster_count": 62, "max_clusters": 50}, 422
    )
    requests = _install_responses(monkeypatch, [(422, body)])
    client = CatalogClient("https://catalog.test")

    with pytest.raises(RouteTooManyClustersError) as excinfo:
        await client.route([f"p{i}" for i in range(3)])

    assert len(requests) == 1
    assert excinfo.value.cluster_count == 62


async def test_retryable_envelope_is_retried_by_status_without_body_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A defined 502 UPSTREAM_UNAVAILABLE flows through the retry loop."""
    monkeypatch.setattr("agent.clients.catalog_client.asyncio.sleep", _no_sleep)
    body = _envelope("UPSTREAM_UNAVAILABLE", {"upstream": "bangumi"}, 502)
    requests = _install_responses(monkeypatch, [(502, body)])
    client = CatalogClient("https://catalog.test")

    with pytest.raises(TransientAPIError, match="HTTP 502"):
        await client.search("氷菓")

    assert len(requests) == 3


async def test_retryable_envelope_then_success_recovers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One 502 envelope followed by a 200 succeeds via retry."""
    monkeypatch.setattr("agent.clients.catalog_client.asyncio.sleep", _no_sleep)
    body = _envelope("UPSTREAM_UNAVAILABLE", {"upstream": "anitabi"}, 502)
    requests = _install_responses(
        monkeypatch,
        [(502, body), (200, {"rows": [], "synced_at": ""})],
    )
    client = CatalogClient("https://catalog.test")

    rows = await client.search("氷菓")

    assert rows == []
    assert len(requests) == 2


async def test_non_json_5xx_keeps_legacy_transient_behavior(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 500 with a non-JSON body still classifies as TransientAPIError."""
    monkeypatch.setattr("agent.clients.catalog_client.asyncio.sleep", _no_sleep)
    requests = _install_responses(monkeypatch, [(500, b"not json")])
    client = CatalogClient("https://catalog.test")

    with pytest.raises(TransientAPIError):
        await client.search("氷菓")

    assert len(requests) == 3


async def test_work_not_found_raises_typed_on_spots(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A defined 404 WORK_NOT_FOUND surfaces the typed exception."""
    monkeypatch.setattr("agent.clients.catalog_client.asyncio.sleep", _no_sleep)
    body = _envelope("WORK_NOT_FOUND", {"bangumi_id": "8000"}, 404)
    requests = _install_responses(monkeypatch, [(404, body)])
    client = CatalogClient("https://catalog.test")

    with pytest.raises(WorkNotFoundError) as excinfo:
        await client.spots("8000")

    assert len(requests) == 1
    assert excinfo.value.bangumi_id == "8000"
