"""Cross-layer timeout budget invariants."""

from __future__ import annotations

import httpx
import pytest

from agent.agents.animichi_tools import CATALOG_TOOL_TIMEOUT_SECONDS
from agent.clients.catalog_client import (
    CATALOG_REQUEST_TIMEOUT_SECONDS,
    CatalogClient,
)
from agent.clients.errors import TransientAPIError
from agent.interfaces.public_api import AGENT_TIMEOUT_SECONDS


async def test_catalog_budget_nests_inside_tool_and_agent_timeouts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    elapsed = 0.0

    async def advance_clock(delay: float) -> None:
        nonlocal elapsed
        elapsed += delay

    def consume_request_budget(request: httpx.Request) -> httpx.Response:
        nonlocal elapsed
        elapsed += CATALOG_REQUEST_TIMEOUT_SECONDS
        return httpx.Response(503, request=request, json={})

    transport = httpx.MockTransport(consume_request_budget)
    monkeypatch.setattr("agent.clients.catalog_client.asyncio.sleep", advance_clock)
    monkeypatch.setattr(
        "agent.clients.catalog_client.httpx.AsyncHTTPTransport",
        lambda **_kwargs: transport,
    )

    with pytest.raises(TransientAPIError):
        await CatalogClient("https://catalog.test").search("氷菓")

    client_budget = elapsed  # 25s * 3 attempts + 1s + 2s backoff = 78s.
    assert client_budget == 78.0
    assert client_budget < CATALOG_TOOL_TIMEOUT_SECONDS < AGENT_TIMEOUT_SECONDS
