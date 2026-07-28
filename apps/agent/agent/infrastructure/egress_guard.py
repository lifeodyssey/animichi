"""SSRF pre-flight validation for user-influenceable outbound HTTP calls (#284 T1).

`validate_base_url` is the pre-flight, request-boundary check: resolves the
host exactly once for that call and accepts an address only under a **dual
condition**: `ip.is_global is True` AND it trips none of the private/loopback/
link-local/reserved/multicast/unspecified flags. Neither half is redundant —
see the docstring on `_is_address_accepted` for the two address families each
half alone would miss. No domain allowlist.

`GuardedAsyncTransport` (in `egress_transport.py`) is the second, independent
layer: it re-runs this same check at connect time and pins the socket to the
address *that* call validated — see its docstring for why that closes the
TOCTOU/DNS-rebinding window.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Final
from urllib.parse import SplitResult, urlsplit

import anyio

from agent.infrastructure.egress_errors import EgressBlocked, EgressBlockReason

IpAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

Resolver = Callable[[str, int], Awaitable[list[str]]]

ALLOWED_SCHEME: Final[str] = "https"
ALLOWED_PORTS: Final[frozenset[int]] = frozenset({443, 8000, 8443})
RESOLUTION_TIMEOUT_SECONDS: Final[float] = 5.0

# DNS resolution runs on its own capacity limiter, not anyio's shared default
# thread pool (40 tokens, shared with every other `to_thread.run_sync` call in
# the process). A `base_url` pointing at a black-hole nameserver must not be
# able to exhaust threads other subsystems depend on.
_DNS_THREAD_LIMITER: Final[anyio.CapacityLimiter] = anyio.CapacityLimiter(4)

# Belt-and-suspenders explicit deny set for well-known cloud-metadata endpoints.
# These IPs already fail the `is_global`/deny-flag classification below on their
# own (169.254.169.254 is link-local; fd00:ec2::254 is a ULA); they are listed
# here anyway so the guard is not silently relying on flag semantics alone for
# the most commonly attacked addresses.
_METADATA_DENY_IPS: Final[frozenset[str]] = frozenset(
    {
        "169.254.169.254",  # AWS / Azure / GCP IMDS
        "fd00:ec2::254",  # AWS IMDSv2 IPv6
        "100.100.100.200",  # Alibaba Cloud / Tencent Cloud metadata
    }
)

# Our own public-facing origins are legitimately globally routable, so every IP
# check above passes them. Without an explicit deny, BYOK egress becomes a
# confused-deputy path back into our own authenticated surfaces, where a
# request may carry more implicit trust than it would from the open internet.
#
# This is a hostname-suffix match, not an IP-based one — it does not follow
# CNAMEs and will not catch a hostname that merely *resolves to* our
# infrastructure's IPs under a different name. Whenever a new public-facing
# origin is added (a new custom domain, a new auth provider host, a new
# internal service hostname), add it here in the same commit.
OWN_INFRASTRUCTURE_HOSTNAMES: Final[frozenset[str]] = frozenset(
    {
        "animichi.com",  # apex + `*.animichi.com` (wrangler.toml route)
        "stack-auth.com",  # Neon Auth (Better Auth) — per-project subdomain
    }
)


@dataclass(frozen=True, slots=True)
class ValidatedEndpoint:
    """A resolve-once, dual-condition-validated egress destination."""

    hostname: str
    port: int
    pinned_ip: str


def _is_own_infrastructure(hostname: str) -> bool:
    return any(
        hostname == domain or hostname.endswith(f".{domain}")
        for domain in OWN_INFRASTRUCTURE_HOSTNAMES
    )


def _trips_any_deny_flag(ip: IpAddress) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _is_address_accepted(ip: IpAddress) -> bool:
    """Dual-condition acceptance test (P1-1 in the spec).

    `ip.is_global is True` alone is insufficient: `64:ff9b::7f00:1` (NAT64
    mapping of 127.0.0.1) is `is_global is True` but `is_reserved is True`, so
    the deny-flag half catches it.

    The deny-flag enumeration alone is also insufficient: `100.64.0.1` (CGNAT,
    RFC 6598) and `100.100.100.200` (Alibaba/Tencent metadata) trip none of
    `is_private`/`is_loopback`/`is_link_local`/`is_reserved`/`is_multicast`/
    `is_unspecified` — all six are False for the whole `100.64.0.0/10` block —
    so only `is_global is False` catches them.

    Both conditions are required; neither is redundant.
    """
    if ip.is_global is not True:
        return False
    if _trips_any_deny_flag(ip):
        return False
    return str(ip) not in _METADATA_DENY_IPS


def _blocking_getaddrinfo(host: str, port: int) -> list[str]:
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [str(info[4][0]) for info in infos]


async def _default_resolve(host: str, port: int) -> list[str]:
    """Resolve `host` once, off the event loop, with a short timeout.

    `abandon_on_cancel=True` is load-bearing: `getaddrinfo` is a blocking libc
    call with no cancellation hook, so without it `anyio.fail_after` cannot
    actually interrupt a thread stuck resolving a black-holed nameserver — the
    timeout would be cosmetic. The thread is abandoned (not joined) on
    timeout and runs on its own 4-slot limiter rather than anyio's shared
    default thread pool, which other subsystems depend on.
    """
    try:
        with anyio.fail_after(RESOLUTION_TIMEOUT_SECONDS):
            return await anyio.to_thread.run_sync(
                _blocking_getaddrinfo,
                host,
                port,
                abandon_on_cancel=True,
                limiter=_DNS_THREAD_LIMITER,
            )
    except TimeoutError as exc:
        raise EgressBlocked(EgressBlockReason.RESOLUTION_TIMEOUT, detail=host) from exc
    except OSError as exc:
        raise EgressBlocked(
            EgressBlockReason.RESOLUTION_FAILED, detail=str(exc)
        ) from exc


def _check_scheme_and_userinfo(parsed: SplitResult) -> None:
    if parsed.scheme != ALLOWED_SCHEME:
        raise EgressBlocked(EgressBlockReason.INVALID_SCHEME, detail=parsed.scheme)
    if parsed.username or parsed.password:
        raise EgressBlocked(EgressBlockReason.INVALID_USERINFO)


def _encode_hostname(hostname: str) -> str:
    """IDNA-encode to the A-label and strip a trailing root-label dot.

    Normalizing the trailing dot is load-bearing, not cosmetic:
    `"animichi.com."`, `"animichi.com。"` (ideographic full stop), and
    `"animichi.com｡"` (halfwidth ideographic full stop) all IDNA-encode to
    `"animichi.com."` — a string distinct from `"animichi.com"` that would
    otherwise slip past `_is_own_infrastructure`'s suffix match even though
    `getaddrinfo` treats a trailing root dot as equivalent to none.
    """
    try:
        return hostname.encode("idna").decode("ascii").rstrip(".")
    except UnicodeError as exc:
        raise EgressBlocked(
            EgressBlockReason.INVALID_HOSTNAME_ENCODING, detail=hostname
        ) from exc


def _check_port(port: int) -> None:
    if port not in ALLOWED_PORTS:
        raise EgressBlocked(EgressBlockReason.INVALID_PORT, detail=str(port))


def _split_url(url: str) -> SplitResult:
    try:
        return urlsplit(url)
    except ValueError as exc:
        # `urlsplit` raises a bare `ValueError` for a netloc that fails its
        # NFKC-normalization safety check (e.g. a confusable/compatibility
        # character, such as U+2100, that expands into a different netloc
        # under normalization). Uncaught, that would break the "every
        # rejection is a typed EgressBlocked" contract Task 3/5 depend on.
        raise EgressBlocked(EgressBlockReason.INVALID_URL) from exc


def _parse_endpoint_shape(url: str) -> tuple[str, int]:
    """Scheme/userinfo/host/port shape validation, before any I/O."""
    parsed = _split_url(url)
    _check_scheme_and_userinfo(parsed)
    if not parsed.hostname:
        raise EgressBlocked(EgressBlockReason.INVALID_HOST)
    a_label = _encode_hostname(parsed.hostname)
    port = parsed.port or 443
    _check_port(port)
    return a_label, port


def _parse_ip_address(candidate: str) -> IpAddress:
    try:
        return ipaddress.ip_address(candidate)
    except ValueError as exc:
        # A resolver is caller-suppliable (tests inject one; a future
        # capability could source one from less-trusted config). A malformed
        # candidate is certainly not an acceptable egress address either way.
        raise EgressBlocked(
            EgressBlockReason.ADDRESS_NOT_ROUTABLE, detail=candidate
        ) from exc


async def _resolve_and_classify(
    hostname: str, port: int, resolver: Resolver
) -> IpAddress:
    addresses = await resolver(hostname, port)
    if not addresses:
        raise EgressBlocked(EgressBlockReason.NO_ADDRESSES, detail=hostname)
    accepted: list[IpAddress] = []
    for candidate in addresses:
        ip = _parse_ip_address(candidate)
        if not _is_address_accepted(ip):
            raise EgressBlocked(
                EgressBlockReason.ADDRESS_NOT_ROUTABLE, detail=candidate
            )
        accepted.append(ip)
    return accepted[0]


async def validate_base_url(
    url: str | None,
    *,
    resolver: Resolver = _default_resolve,
) -> ValidatedEndpoint:
    """Pre-flight SSRF validation. Raises `EgressBlocked` before any socket opens."""
    if url is None or not url.strip():
        raise EgressBlocked(EgressBlockReason.EMPTY_URL)

    hostname, port = _parse_endpoint_shape(url.strip())

    if _is_own_infrastructure(hostname):
        raise EgressBlocked(EgressBlockReason.OWN_INFRASTRUCTURE, detail=hostname)

    pinned = await _resolve_and_classify(hostname, port, resolver)
    return ValidatedEndpoint(hostname=hostname, port=port, pinned_ip=str(pinned))
