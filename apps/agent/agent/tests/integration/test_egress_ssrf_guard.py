"""Integration tests for the SSRF egress guard's transport mechanics (#284 T1).

Uses a real self-signed TLS stub server (`_egress_tls_stub.py`) bound to
127.0.0.1 so the happy-path assertion can prove `sni_hostname` actually reaches
the TLS handshake as the *original* hostname while the socket connects to the
*pinned* IP literal. Pure address-classification cases (AC3/AC4/AC7) live in
`test_egress_ssrf_guard_addresses.py` to keep this file under the 200-line cap.

The cert/key pair is generated once per test session (`tls_cert_files`,
session-scoped — RSA key generation is the expensive part); the asyncio
server itself is started fresh per test (`tls_stub_server`, function-scoped)
for state isolation and to avoid port/history bleed between tests.
"""

from __future__ import annotations

import ssl
from collections.abc import AsyncIterator, Awaitable, Callable

import httpx
import pytest

from agent.infrastructure import egress_guard
from agent.infrastructure.egress_guard import EgressBlocked
from agent.infrastructure.egress_transport import GuardedAsyncTransport
from agent.tests.integration._egress_tls_stub import (
    TEST_HOSTNAME,
    TEST_HOSTNAME_B,
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


@pytest.fixture(scope="session")
def tls_cert_files(tmp_path_factory: pytest.TempPathFactory) -> tuple[str, str]:
    directory = tmp_path_factory.mktemp("egress-guard-tls")
    return write_self_signed_cert(directory)


@pytest.fixture
async def tls_stub_server(
    tls_cert_files: tuple[str, str],
) -> AsyncIterator[TlsProbeServer]:
    cert_path, key_path = tls_cert_files
    server = TlsProbeServer(cert_path, key_path)
    await server.start()
    try:
        yield server
    finally:
        await server.aclose()


def _guarded_client_for_stub(
    server: TlsProbeServer, resolver: Callable[[str, int], Awaitable[list[str]]]
) -> httpx.AsyncClient:
    trust_ctx = ssl.create_default_context(cafile=server.cert_path)
    transport = GuardedAsyncTransport(resolver=resolver, verify=trust_ctx)
    return httpx.AsyncClient(
        transport=transport, trust_env=False, follow_redirects=False
    )


# ── AC1: happy path — pinned connect, correct Host + preserved SNI ──────────


async def test_happy_path_reaches_stub_with_original_host_and_sni(
    tls_stub_server: TlsProbeServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        egress_guard, "ALLOWED_PORTS", frozenset({tls_stub_server.port})
    )
    # The stub server only binds to loopback, which the classification
    # (correctly) denies — exercised thoroughly in test_egress_ssrf_guard_addresses.py.
    # This test isolates the pinning/rewrite/TLS wiring, so acceptance is
    # forced for the single resolved address under test.
    monkeypatch.setattr(egress_guard, "_is_address_accepted", lambda _ip: True)
    client = _guarded_client_for_stub(tls_stub_server, _resolver(["127.0.0.1"]))

    response = await client.get(f"https://{TEST_HOSTNAME}:{tls_stub_server.port}/probe")
    await client.aclose()

    assert response.status_code == 200
    assert (
        tls_stub_server.received_host_header
        == f"{TEST_HOSTNAME}:{tls_stub_server.port}"
    )
    assert tls_stub_server.received_sni == TEST_HOSTNAME


# ── P2-A regression: distinct hostnames sharing a pinned IP never share a
#    keep-alive connection (which would reuse a TLS session verified for the
#    *other* hostname's SNI) ─────────────────────────────────────────────────


async def test_distinct_hostnames_sharing_pinned_ip_get_isolated_connections(
    tls_stub_server: TlsProbeServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        egress_guard, "ALLOWED_PORTS", frozenset({tls_stub_server.port})
    )
    monkeypatch.setattr(egress_guard, "_is_address_accepted", lambda _ip: True)
    # Both hostnames resolve to the *same* pinned IP (the one real server).
    client = _guarded_client_for_stub(tls_stub_server, _resolver(["127.0.0.1"]))

    port = tls_stub_server.port
    first = await client.get(f"https://{TEST_HOSTNAME}:{port}/a")
    second = await client.get(f"https://{TEST_HOSTNAME_B}:{port}/b")
    await client.aclose()

    assert first.status_code == 200
    assert second.status_code == 200
    assert tls_stub_server.connection_count == 2, (
        "each request must open its own connection"
    )
    assert tls_stub_server.sni_history == [TEST_HOSTNAME, TEST_HOSTNAME_B]
    assert tls_stub_server.host_header_history == [
        f"{TEST_HOSTNAME}:{port}",
        f"{TEST_HOSTNAME_B}:{port}",
    ]


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
