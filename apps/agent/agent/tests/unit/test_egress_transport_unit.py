"""Unit tests for `GuardedAsyncTransport` request rewriting (#284 T1).

Split out from `test_egress_guard_classification.py` (which covers
`validate_base_url` shape/classification rules) to keep each file under the
200-line test-file cap.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import httpx
import pytest

from agent.infrastructure.egress_transport import (
    GuardedAsyncTransport,
    build_guarded_async_client,
)

pytestmark = pytest.mark.unit


def _resolver(addresses: list[str]) -> Callable[[str, int], Awaitable[list[str]]]:
    async def _resolve(_host: str, _port: int) -> list[str]:
        return addresses

    return _resolve


# ── T13 / T1-AC9: proxy-free, trust_env=False client construction ──────────


def test_guarded_client_has_no_proxy_mounts_even_with_proxy_env_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HTTPS_PROXY", "http://evil-proxy.test:9999")
    monkeypatch.setenv("ALL_PROXY", "http://evil-proxy.test:9999")

    # Control: a default (trust_env=True) client DOES pick up the proxy env,
    # proving the environment variables are actually in effect for this test.
    control = httpx.AsyncClient()
    assert len(control._mounts) > 0

    client = build_guarded_async_client()
    assert client._trust_env is False
    assert client._mounts == {}
    assert isinstance(client._transport, GuardedAsyncTransport)


async def test_guarded_transport_ignores_proxy_env_and_pins_to_resolved_ip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HTTPS_PROXY", "http://evil-proxy.test:9999")
    recorded: dict[str, str] = {}

    async def _fake_handler(request: httpx.Request) -> httpx.Response:
        recorded["host"] = request.url.host
        return httpx.Response(200, request=request)

    transport = GuardedAsyncTransport(
        resolver=_resolver(["8.8.8.8"]),
        inner=httpx.MockTransport(_fake_handler),
    )
    client = httpx.AsyncClient(transport=transport, trust_env=False)
    response = await client.request("GET", "https://host.example/v1")
    assert response.status_code == 200
    assert recorded["host"] == "8.8.8.8"
    await client.aclose()


# ── Transport-level rewrite: Host header + sni_hostname + IPv6/punycode ────


async def test_transport_rewrites_host_header_and_sni_hostname() -> None:
    recorded: dict[str, object] = {}

    async def _fake_handler(request: httpx.Request) -> httpx.Response:
        recorded["url"] = str(request.url)
        recorded["host_header"] = request.headers["host"]
        recorded["sni_hostname"] = request.extensions.get("sni_hostname")
        return httpx.Response(200, request=request)

    transport = GuardedAsyncTransport(
        resolver=_resolver(["93.184.216.34"]),
        inner=httpx.MockTransport(_fake_handler),
    )
    client = httpx.AsyncClient(transport=transport, trust_env=False)
    await client.request("GET", "https://example.com:8443/v1/chat")
    await client.aclose()

    assert recorded["url"] == "https://93.184.216.34:8443/v1/chat"
    assert recorded["host_header"] == "example.com:8443"
    assert recorded["sni_hostname"] == "example.com"


async def test_transport_rewrites_punycode_host_to_a_label() -> None:
    recorded: dict[str, object] = {}

    async def _fake_handler(request: httpx.Request) -> httpx.Response:
        recorded["host_header"] = request.headers["host"]
        recorded["sni_hostname"] = request.extensions.get("sni_hostname")
        return httpx.Response(200, request=request)

    transport = GuardedAsyncTransport(
        resolver=_resolver(["8.8.8.8"]),
        inner=httpx.MockTransport(_fake_handler),
    )
    client = httpx.AsyncClient(transport=transport, trust_env=False)
    await client.request("GET", "https://ドメイン.jp/v1")
    await client.aclose()

    assert recorded["host_header"] == "xn--eckwd4c7c.jp"
    assert recorded["sni_hostname"] == "xn--eckwd4c7c.jp"


async def test_transport_brackets_ipv6_host_header() -> None:
    recorded: dict[str, object] = {}

    async def _fake_handler(request: httpx.Request) -> httpx.Response:
        recorded["url"] = str(request.url)
        recorded["host_header"] = request.headers["host"]
        return httpx.Response(200, request=request)

    transport = GuardedAsyncTransport(
        resolver=_resolver(["2606:4700::1"]),
        inner=httpx.MockTransport(_fake_handler),
    )
    client = httpx.AsyncClient(transport=transport, trust_env=False)
    await client.request("GET", "https://[2606:4700::1]/v1")
    await client.aclose()

    assert recorded["url"] == "https://[2606:4700::1]/v1"
    assert recorded["host_header"] == "[2606:4700::1]"
