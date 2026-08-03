"""Unit tests for CatalogClient's official retry transport and lifecycle."""

from __future__ import annotations

from agent.clients.catalog_client import CatalogClient


async def test_aclose_without_requests_is_noop() -> None:
    client = CatalogClient("https://catalog.test")

    await client.aclose()

    assert client._client is None
