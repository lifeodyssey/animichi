"""Unit tests for the SSRF egress guard's classification and shape rules (#284 T1).

Transport-level rewrite/proxy tests live in `test_egress_transport_unit.py`,
and `default_resolve`'s DNS-behaviour tests live in
`test_egress_dns_resolution.py` — split out to keep each file under the
200-line test-file cap.
"""

from __future__ import annotations

import ipaddress
from collections.abc import Awaitable, Callable

import pytest

from agent.infrastructure.egress_guard import (
    ALLOWED_PORTS,
    EgressBlocked,
    EgressBlockReason,
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
    [
        None,
        "",
        "   ",
        "host/path",
        "https://user:pw@host",
        "https://host:22",
        "https://",
    ],
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


async def test_idna_encoding_error_is_rejected() -> None:
    oversized_label = "a" * 64  # single DNS label max is 63 octets
    with pytest.raises(EgressBlocked) as exc_info:
        await validate_base_url(
            f"https://{oversized_label}.example", resolver=_resolver(["8.8.8.8"])
        )
    assert exc_info.value.reason is EgressBlockReason.INVALID_HOSTNAME_ENCODING


async def test_zero_resolved_addresses_is_rejected() -> None:
    with pytest.raises(EgressBlocked) as exc_info:
        await validate_base_url("https://host", resolver=_resolver([]))
    assert exc_info.value.reason is EgressBlockReason.NO_ADDRESSES


@pytest.mark.parametrize(
    "hostname",
    [
        "animichi.com",
        "api.animichi.com",
        "stack-auth.com",
        "project.stack-auth.com",
        "animichi.com.",  # trailing root-label dot
        "animichi.com。",  # ideographic full stop — IDNA-normalizes to "."
        "animichi.com｡",  # halfwidth ideographic full stop — same
        "api.animichi.com.",
    ],
)
async def test_own_infrastructure_hostname_is_rejected(hostname: str) -> None:
    """Includes the trailing-dot/full-width-dot variants (Fable review): all
    four IDNA-encode to a string ending in a literal dot that would otherwise
    slip past a naive suffix match, even though DNS treats the trailing root
    dot as equivalent to none."""
    with pytest.raises(EgressBlocked) as exc_info:
        await validate_base_url(f"https://{hostname}", resolver=_resolver(["8.8.8.8"]))
    assert exc_info.value.reason is EgressBlockReason.OWN_INFRASTRUCTURE


async def test_nfkc_confusable_netloc_raises_typed_error() -> None:
    """`urlsplit` raises a bare `ValueError` for a netloc that fails its
    NFKC-normalization safety check (U+2100 expands to `a/c` under NFKC).
    Uncaught, this breaks the "every rejection is EgressBlocked" contract
    Task 3/5 depend on."""
    with pytest.raises(EgressBlocked) as exc_info:
        await validate_base_url(
            "https://℀animichi.com", resolver=_resolver(["8.8.8.8"])
        )
    assert exc_info.value.reason is EgressBlockReason.INVALID_URL


async def test_malformed_resolver_candidate_raises_typed_error() -> None:
    with pytest.raises(EgressBlocked) as exc_info:
        await validate_base_url("https://host", resolver=_resolver(["not-an-ip"]))
    assert exc_info.value.reason is EgressBlockReason.ADDRESS_NOT_ROUTABLE


# ── P2-3: the interpreter primitive itself, asserted directly ───────────────


def test_cgnat_address_is_not_global_on_this_interpreter() -> None:
    """Guards against CPython 3.11.0-3.11.9 (pre gh-113171): a build on that
    range would silently lose the P1-1 protection while every other test stays
    green. Fail loudly here instead."""
    assert ipaddress.ip_address("100.64.0.1").is_global is False


# ── P2-B: error messages are fixed constants, never interpolated data ──────


async def test_error_message_never_embeds_the_offending_address() -> None:
    with pytest.raises(EgressBlocked) as exc_info:
        await validate_base_url(
            "https://internal.example", resolver=_resolver(["10.1.2.3"])
        )
    assert "10.1.2.3" not in str(exc_info.value)
    assert exc_info.value.reason is EgressBlockReason.ADDRESS_NOT_ROUTABLE
    assert exc_info.value.detail == "10.1.2.3"
