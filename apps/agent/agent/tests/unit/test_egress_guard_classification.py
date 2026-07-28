"""Unit tests for the SSRF egress guard's classification and shape rules (#284 T1)."""

from __future__ import annotations

import ipaddress
from collections.abc import Awaitable, Callable

import httpx
import pytest

from agent.infrastructure.egress_guard import (
    ALLOWED_PORTS,
    EgressBlocked,
    GuardedAsyncTransport,
    build_guarded_async_client,
    validate_base_url,
)

pytestmark = pytest.mark.unit


def _resolver(addresses: list[str]) -> Callable[[str, int], Awaitable[list[str]]]:
    async def _resolve(_host: str, _port: int) -> list[str]:
        return addresses

    return _resolve


# ── Null / empty / boundary shape validation ────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [None, "", "   ", "host/path", "https://user:pw@host", "https://host:22"],
)
async def test_rejects_malformed_or_boundary_urls_individually(url: str | None) -> None:
    with pytest.raises(EgressBlocked):
        await validate_base_url(url, resolver=_resolver(["8.8.8.8"]))


@pytest.mark.parametrize("scheme", ["http", "file", "gopher", "ftp"])
async def test_rejects_disallowed_schemes_before_resolution(scheme: str) -> None:
    called = False

    async def _resolve(_host: str, _port: int) -> list[str]:
        nonlocal called
        called = True
        return ["8.8.8.8"]

    with pytest.raises(EgressBlocked):
        await validate_base_url(f"{scheme}://host", resolver=_resolve)
    assert called is False, "resolver must not run for a disallowed scheme"


@pytest.mark.parametrize("port", sorted(ALLOWED_PORTS))
async def test_accepts_allowlisted_ports_with_public_address(port: int) -> None:
    endpoint = await validate_base_url(
        f"https://host:{port}", resolver=_resolver(["8.8.8.8"])
    )
    assert endpoint.port == port


async def test_punycode_hostname_resolves_to_a_label() -> None:
    endpoint = await validate_base_url(
        "https://ドメイン.jp", resolver=_resolver(["8.8.8.8"])
    )
    assert endpoint.hostname == "xn--eckwd4c7c.jp"


async def test_ipv6_literal_host_is_accepted_when_globally_routable() -> None:
    endpoint = await validate_base_url(
        "https://[2606:4700::1]", resolver=_resolver(["2606:4700::1"])
    )
    assert endpoint.hostname == "2606:4700::1"
    assert endpoint.pinned_ip == "2606:4700::1"


# ── P2-3: the interpreter primitive itself, asserted directly ───────────────


def test_cgnat_address_is_not_global_on_this_interpreter() -> None:
    """Guards against CPython 3.11.0-3.11.9 (pre gh-113171): a build on that
    range would silently lose the P1-1 protection while every other test stays
    green. Fail loudly here instead."""
    assert ipaddress.ip_address("100.64.0.1").is_global is False


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


# ── Transport-level rewrite: Host header + sni_hostname + IPv6 bracketing ──


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
