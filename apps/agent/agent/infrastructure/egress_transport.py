"""Connect-time SSRF enforcement transport for BYOK egress (#284 Task 1).

`GuardedAsyncTransport` independently re-runs `egress_guard.validate_base_url`
at connect time (its own single resolution), pins the socket to the address
*that* call validated, preserves TLS hostname verification via
`sni_hostname`, and refuses every 3xx response. This is what closes the
TOCTOU/DNS-rebinding window: httpcore never resolves the hostname itself,
because by the time it sees the request the host has already been rewritten
to a validated IP literal.
"""

from __future__ import annotations

import ssl

import httpx

from agent.infrastructure.egress_errors import EgressBlocked, EgressBlockReason
from agent.infrastructure.egress_guard import (
    Resolver,
    ValidatedEndpoint,
    _default_resolve,
    validate_base_url,
)


def _format_host_header(hostname: str, port: int) -> str:
    host_part = f"[{hostname}]" if ":" in hostname else hostname
    return host_part if port == 443 else f"{host_part}:{port}"


def _rewrite_for_pinned_endpoint(
    request: httpx.Request, endpoint: ValidatedEndpoint
) -> None:
    request.url = request.url.copy_with(host=endpoint.pinned_ip)
    request.headers["host"] = _format_host_header(endpoint.hostname, endpoint.port)
    request.extensions = {**request.extensions, "sni_hostname": endpoint.hostname}


async def _reject_if_redirect(
    response: httpx.Response, endpoint: ValidatedEndpoint
) -> None:
    if not (300 <= response.status_code < 400):
        return
    await response.aread()
    await response.aclose()
    raise EgressBlocked(EgressBlockReason.REDIRECT_REFUSED, detail=endpoint.hostname)


def _build_inner_transport(
    verify: ssl.SSLContext | str | bool,
) -> httpx.AsyncHTTPTransport:
    # `max_keepalive_connections=0` (P2-A): see GuardedAsyncTransport docstring
    # — without it, two different BYOK hostnames resolving to the same pinned
    # IP could reuse a pooled connection whose TLS session was verified for
    # the *other* hostname's SNI.
    return httpx.AsyncHTTPTransport(
        verify=verify,
        trust_env=False,
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=0),
    )


class GuardedAsyncTransport(httpx.AsyncBaseTransport):
    """`httpx` transport enforcing SSRF validation at connect time.

    Re-runs `validate_base_url` per request (covers a provider SDK appending
    paths or a redirect target), rewrites the request to the pinned IP literal
    while preserving the original `Host` header and TLS SNI hostname, and
    rejects every 3xx response outright.

    Constructed with `max_keepalive_connections=0` on the inner transport
    (P2-A): httpcore's connection pool keys a pooled connection by
    `(scheme, host, port)` — and after the host rewrite, `host` is the
    *pinned IP*, not the original hostname. Two different BYOK hostnames that
    happen to resolve to the same IP would otherwise be able to reuse a
    keep-alive connection whose TLS session was verified for the *other*
    hostname's SNI, silently sending a second identity's request over the
    first's authenticated channel. Disabling keep-alive forces a fresh
    connection (and thus a fresh, correctly-SNI'd handshake) per request.
    """

    def __init__(
        self,
        *,
        resolver: Resolver = _default_resolve,
        inner: httpx.AsyncBaseTransport | None = None,
        verify: ssl.SSLContext | str | bool = True,
    ) -> None:
        self._resolver = resolver
        self._inner = inner if inner is not None else _build_inner_transport(verify)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        endpoint = await validate_base_url(str(request.url), resolver=self._resolver)
        _rewrite_for_pinned_endpoint(request, endpoint)
        response = await self._inner.handle_async_request(request)
        await _reject_if_redirect(response, endpoint)
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
