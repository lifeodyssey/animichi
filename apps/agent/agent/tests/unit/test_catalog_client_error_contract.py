"""Unit tests: CatalogClient parses oRPC error envelopes into typed errors."""

from __future__ import annotations

import httpx
import pytest

from agent.clients.catalog_client import CatalogClient
from agent.clients.catalog_errors import RouteTooManyClustersError

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
