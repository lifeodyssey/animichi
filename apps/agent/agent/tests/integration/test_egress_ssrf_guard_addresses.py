"""Integration tests for SSRF egress guard address-classification cases (#284 T1).

Split out from `test_egress_ssrf_guard.py` (which covers real TLS/transport
mechanics) to keep each file under the 200-line test-file cap.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Awaitable, Callable

import pytest

from agent.infrastructure.egress_guard import EgressBlocked, validate_base_url
from agent.infrastructure.egress_transport import build_guarded_async_client

pytestmark = pytest.mark.integration


def _resolver(addresses: list[str]) -> Callable[[str, int], Awaitable[list[str]]]:
    async def _resolve(_host: str, _port: int) -> list[str]:
        return addresses

    return _resolve


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


async def test_ip_literal_url_never_opens_a_socket(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """P3: goes through the full guarded client with the *real* resolver (not
    a stub) so a real `socket.socket()` call would happen here if the guard's
    pre-flight rejection didn't fire before the transport ever tried to
    connect. `getaddrinfo` on a literal IP is a local parse, not network I/O,
    so this stays hermetic."""

    def _forbidden(*_args: object, **_kwargs: object) -> socket.socket:
        raise AssertionError(
            "socket.socket() must not be called for a blocked destination"
        )

    monkeypatch.setattr(socket, "socket", _forbidden)
    client = build_guarded_async_client()

    with pytest.raises(EgressBlocked):
        await client.get("https://169.254.169.254/latest/meta-data/")
    await client.aclose()


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


async def test_forbidden_ip_from_injected_resolver_is_rejected() -> None:
    with pytest.raises(EgressBlocked):
        await validate_base_url(
            "https://internal.example", resolver=_resolver(["10.1.2.3"])
        )


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
