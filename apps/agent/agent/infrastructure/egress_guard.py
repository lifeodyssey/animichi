"""SSRF egress guard for user-influenceable outbound HTTP calls (#284 Task 1).

Two layers, both required (see `docs/superpowers/specs/2026-07-28-284-byok-design.md`):

1. `validate_base_url` — a pre-flight, resolve-once check at the request boundary.
2. `GuardedAsyncTransport` — an `httpx` transport that re-validates at connect time,
   pins the socket to the already-validated IP literal, preserves TLS hostname
   verification via `sni_hostname`, and refuses every 3xx response.

No domain allowlist. Acceptance is a **dual condition** on the resolved IP:
`ip.is_global is True` AND it trips none of the private/loopback/link-local/
reserved/multicast/unspecified flags. Neither half is redundant — see the
docstring on `_is_address_accepted` for the two address families each half alone
would miss.
"""

from __future__ import annotations

import ipaddress
import socket
import ssl
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Final
from urllib.parse import urlsplit

import anyio
import httpx

IpAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

Resolver = Callable[[str, int], Awaitable[list[str]]]

ALLOWED_SCHEME: Final[str] = "https"
ALLOWED_PORTS: Final[frozenset[int]] = frozenset({443, 8000, 8443})
RESOLUTION_TIMEOUT_SECONDS: Final[float] = 5.0

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
# confused-deputy path back into our own authenticated surfaces.
OWN_INFRASTRUCTURE_HOSTNAMES: Final[frozenset[str]] = frozenset({"animichi.com"})


class EgressBlocked(Exception):
    """Raised whenever a candidate egress destination fails SSRF validation."""


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
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    ):
        return False
    return str(ip) not in _METADATA_DENY_IPS


async def _default_resolve(host: str, port: int) -> list[str]:
    """Resolve `host` once, off the event loop, with a short timeout."""

    def _getaddrinfo() -> list[str]:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        return [str(info[4][0]) for info in infos]

    try:
        with anyio.fail_after(RESOLUTION_TIMEOUT_SECONDS):
            return await anyio.to_thread.run_sync(_getaddrinfo)
    except TimeoutError as exc:
        raise EgressBlocked(f"DNS resolution timed out for {host!r}") from exc
    except OSError as exc:
        raise EgressBlocked(f"DNS resolution failed for {host!r}: {exc}") from exc


def _parse_endpoint_shape(url: str) -> tuple[str, int]:
    """Scheme/userinfo/host/port shape validation, before any I/O."""
    parsed = urlsplit(url)
    if parsed.scheme != ALLOWED_SCHEME:
        raise EgressBlocked(f"scheme must be {ALLOWED_SCHEME!r}, got {parsed.scheme!r}")
    if parsed.username or parsed.password:
        raise EgressBlocked("userinfo is not allowed in the egress URL")
    hostname = parsed.hostname
    if not hostname:
        raise EgressBlocked("egress URL is missing a host")
    try:
        a_label = hostname.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise EgressBlocked(f"invalid hostname: {hostname!r}") from exc
    port = parsed.port or 443
    if port not in ALLOWED_PORTS:
        raise EgressBlocked(f"port {port} is not on the egress allowlist")
    return a_label, port


async def validate_base_url(
    url: str | None,
    *,
    resolver: Resolver = _default_resolve,
) -> ValidatedEndpoint:
    """Pre-flight SSRF validation. Raises `EgressBlocked` before any socket opens."""
    if url is None or not url.strip():
        raise EgressBlocked("egress URL is empty")

    hostname, port = _parse_endpoint_shape(url.strip())

    if _is_own_infrastructure(hostname):
        raise EgressBlocked(f"host {hostname!r} is own infrastructure")

    addresses = await resolver(hostname, port)
    if not addresses:
        raise EgressBlocked(f"no addresses resolved for {hostname!r}")

    accepted: list[IpAddress] = []
    for candidate in addresses:
        ip = ipaddress.ip_address(candidate)
        if not _is_address_accepted(ip):
            raise EgressBlocked(
                f"resolved address {candidate} is not publicly routable"
            )
        accepted.append(ip)

    return ValidatedEndpoint(hostname=hostname, port=port, pinned_ip=str(accepted[0]))


def _format_host_header(hostname: str, port: int) -> str:
    host_part = f"[{hostname}]" if ":" in hostname else hostname
    return host_part if port == 443 else f"{host_part}:{port}"


class GuardedAsyncTransport(httpx.AsyncBaseTransport):
    """`httpx` transport enforcing SSRF validation at connect time.

    Re-runs `validate_base_url` per request (covers a provider SDK appending
    paths or a redirect target), rewrites the request to the pinned IP literal
    while preserving the original `Host` header and TLS SNI hostname, and
    rejects every 3xx response outright.
    """

    def __init__(
        self,
        *,
        resolver: Resolver = _default_resolve,
        inner: httpx.AsyncBaseTransport | None = None,
        verify: ssl.SSLContext | str | bool = True,
    ) -> None:
        self._resolver = resolver
        self._inner = (
            inner
            if inner is not None
            else httpx.AsyncHTTPTransport(verify=verify, trust_env=False)
        )

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        endpoint = await validate_base_url(str(request.url), resolver=self._resolver)
        request.url = request.url.copy_with(host=endpoint.pinned_ip)
        request.headers["host"] = _format_host_header(endpoint.hostname, endpoint.port)
        request.extensions = {
            **request.extensions,
            "sni_hostname": endpoint.hostname,
        }
        response = await self._inner.handle_async_request(request)
        if 300 <= response.status_code < 400:
            await response.aread()
            await response.aclose()
            raise EgressBlocked(
                f"redirect response ({response.status_code}) refused for {endpoint.hostname!r}"
            )
        return response

    async def aclose(self) -> None:
        await self._inner.aclose()


def build_guarded_async_client(
    *,
    resolver: Resolver = _default_resolve,
    timeout: httpx.Timeout | float | None = None,
    verify: ssl.SSLContext | str | bool = True,
) -> httpx.AsyncClient:
    """Build the per-request BYOK transport.

    `trust_env=False` and no `mounts`/`proxy` (T13): a proxy environment
    variable would otherwise route the "pinned-IP" connection through a proxy
    that re-resolves the hostname itself, silently voiding the pinning
    guarantee. `verify` is exposed only so tests can pin a private test CA;
    production callers should leave it at the default.
    """
    return httpx.AsyncClient(
        transport=GuardedAsyncTransport(resolver=resolver, verify=verify),
        trust_env=False,
        follow_redirects=False,
        timeout=timeout if timeout is not None else httpx.Timeout(30.0),
    )
