"""Integration tests for the SSRF egress guard (#284 Task 1).

Uses a real self-signed TLS stub server (`_egress_tls_stub.py`) bound to
127.0.0.1 so the happy-path assertion can prove `sni_hostname` actually reaches
the TLS handshake as the *original* hostname while the socket connects to the
*pinned* IP literal.
"""

from __future__ import annotations

import ipaddress
import ssl
from collections.abc import AsyncIterator, Awaitable, Callable

import httpx
import pytest

from agent.infrastructure import egress_guard
from agent.infrastructure.egress_guard import (
    EgressBlocked,
    GuardedAsyncTransport,
    build_guarded_async_client,
    validate_base_url,
)
from agent.tests.integration._egress_tls_stub import (
    TEST_HOSTNAME,
    TlsProbeServer,
    write_self_signed_cert,
)

pytestmark = pytest.mark.integration


def _resolver(addresses: list[str]) -> Callable[[str, int], Awaitable[list[str]]]:
    async def _resolve(_host: str, _port: int) -> list[str]:
        return addresses

    return _resolve


def _sequenced_resolver(
    responses: list[list[str]],
) -> tuple[Callable[[str, int], Awaitable[list[str]]], list[int]]:
    calls = [0]

    async def _resolve(_host: str, _port: int) -> list[str]:
        calls[0] += 1
        return responses[calls[0] - 1]

    return _resolve, calls


@pytest.fixture
async def tls_stub_server(
    tmp_path_factory: pytest.TempPathFactory,
) -> AsyncIterator[TlsProbeServer]:
    directory = tmp_path_factory.mktemp("egress-guard-tls")
    cert_path, key_path = write_self_signed_cert(directory)
    server = TlsProbeServer(cert_path, key_path)
    await server.start()
    try:
        yield server
    finally:
        await server.aclose()


# ── AC1: happy path — pinned connect, correct Host + preserved SNI ──────────


async def test_happy_path_reaches_stub_with_original_host_and_sni(
    tls_stub_server: TlsProbeServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        egress_guard, "ALLOWED_PORTS", frozenset({tls_stub_server.port})
    )
    # The stub server only binds to loopback, which the classification
    # (correctly) denies — exercised thoroughly elsewhere (AC3/AC4/AC7). This
    # test isolates the pinning/rewrite/TLS wiring, so acceptance is forced
    # for the single resolved address under test.
    monkeypatch.setattr(egress_guard, "_is_address_accepted", lambda _ip: True)
    resolver = _resolver(["127.0.0.1"])
    trust_ctx = ssl.create_default_context(cafile=tls_stub_server.cert_path)
    client = build_guarded_async_client(resolver=resolver, verify=trust_ctx)

    response = await client.get(f"https://{TEST_HOSTNAME}:{tls_stub_server.port}/probe")
    await client.aclose()

    assert response.status_code == 200
    assert (
        tls_stub_server.received_host_header
        == f"{TEST_HOSTNAME}:{tls_stub_server.port}"
    )
    assert tls_stub_server.received_sni == TEST_HOSTNAME


# ── AC3 (SD-20 case ①): IP-literal base_url rejected, no socket opened ─────


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1",
        "https://127.0.0.1",
        "https://10.0.0.5",
        "https://169.254.169.254",
    ],
)
async def test_ip_literal_base_url_rejected_without_opening_a_socket(url: str) -> None:
    with pytest.raises(EgressBlocked):
        await validate_base_url(url)


# ── AC4 (P1-1 regression): dual-condition load-bearing cases ───────────────


@pytest.mark.parametrize(
    "address", ["100.100.100.200", "100.64.0.1", "64:ff9b::7f00:1"]
)
async def test_dual_condition_regression_addresses_are_denied(address: str) -> None:
    with pytest.raises(EgressBlocked):
        await validate_base_url("https://host", resolver=_resolver([address]))


def test_cgnat_is_global_false_asserted_directly() -> None:
    """P2-3 (rev5): folded into T1-AC4 so a build on CPython 3.11.0-3.11.9
    (pre gh-113171) fails loudly here instead of silently losing the P1-1
    protection while every other test stays green."""
    assert ipaddress.ip_address("100.64.0.1").is_global is False


# ── AC5 (T4 TOCTOU): resolve-once, pin, never a later re-resolution ─────────


async def test_toctou_connects_only_to_first_resolved_address() -> None:
    resolver, calls = _sequenced_resolver([["8.8.8.8"], ["10.0.0.1"]])
    recorded: dict[str, str] = {}

    async def _fake_handler(request: httpx.Request) -> httpx.Response:
        recorded["host"] = request.url.host
        return httpx.Response(200, request=request)

    transport = GuardedAsyncTransport(
        resolver=resolver, inner=httpx.MockTransport(_fake_handler)
    )
    client = httpx.AsyncClient(transport=transport, trust_env=False)
    response = await client.get("https://rebind.example/v1")
    await client.aclose()

    assert response.status_code == 200
    assert recorded["host"] == "8.8.8.8"
    assert calls[0] == 1, "must resolve exactly once per request, never re-query"


async def test_forbidden_ip_from_injected_resolver_is_rejected() -> None:
    with pytest.raises(EgressBlocked):
        await validate_base_url(
            "https://internal.example", resolver=_resolver(["10.1.2.3"])
        )


# ── AC6 (SD-20 case ③): redirects are refused, never followed ──────────────


async def test_redirect_response_is_refused_not_followed() -> None:
    async def _redirecting_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            302,
            headers={"location": "http://169.254.169.254/latest/meta-data/"},
            request=request,
        )

    transport = GuardedAsyncTransport(
        resolver=_resolver(["8.8.8.8"]), inner=httpx.MockTransport(_redirecting_handler)
    )
    client = httpx.AsyncClient(
        transport=transport, trust_env=False, follow_redirects=False
    )
    assert client.follow_redirects is False

    with pytest.raises(EgressBlocked):
        await client.get("https://host.example/v1")
    await client.aclose()


# ── AC7 (SD-20 case ④): IPv6 loopback / mapped / mixed record sets ─────────


@pytest.mark.parametrize(
    "addresses",
    [
        ["::1"],
        ["::ffff:127.0.0.1"],
        ["8.8.8.8", "fd00::1"],  # mixed public-A + private-AAAA
    ],
)
async def test_ipv6_special_and_mixed_record_sets_are_rejected(
    addresses: list[str],
) -> None:
    with pytest.raises(EgressBlocked):
        await validate_base_url("https://host", resolver=_resolver(addresses))
