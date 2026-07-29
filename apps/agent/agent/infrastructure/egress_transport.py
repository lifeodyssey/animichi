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
    default_resolve,
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
        resolver: Resolver = default_resolve,
        inner: httpx.AsyncBaseTransport | None = None,
        verify: ssl.SSLContext | str | bool = True,
    ) -> None:
        self._resolver = resolver
        self._inner = inner if inner is not None else _build_inner_transport(verify)
        # BYOK spec X3/P1-1, Option A: exclude the *inner* transport from
        # global Logfire/OTel httpx instrumentation. `logfire.instrument_httpx()`
        # (no `client` argument) patches `httpx.AsyncHTTPTransport` at the
        # class level — and `_inner` is exactly that class, so without this,
        # every BYOK egress request would still be auto-instrumented via the
        # inner call and record `url.full` (the user's `base_url`, path and
        # query included) on a span. Excluding `client._transport` itself
        # (a `GuardedAsyncTransport`, never an `AsyncHTTPTransport`) would be
        # a no-op — the class-level patch only ever touches `_inner`. Applied
        # here, not in `build_guarded_async_client`, so it protects every
        # `GuardedAsyncTransport`, not just clients built through that one
        # factory.
        _exclude_from_httpx_instrumentation(self._inner)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        endpoint = await validate_base_url(str(request.url), resolver=self._resolver)
        _rewrite_for_pinned_endpoint(request, endpoint)
        response = await self._inner.handle_async_request(request)
        await _reject_if_redirect(response, endpoint)
        return response

    async def aclose(self) -> None:
        await self._inner.aclose()


def _exclude_from_httpx_instrumentation(transport: httpx.AsyncBaseTransport) -> None:
    """Opt this transport instance out of global Logfire/OTel instrumentation.

    `logfire.instrument_httpx()` with no `client` argument monkey-patches
    `httpx.AsyncHTTPTransport.handle_async_request` at the *class* level via
    `wrapt`. `opentelemetry`'s own `HTTPXClientInstrumentor.uninstrument_client`
    would target `client._transport` — but that is the outer
    `GuardedAsyncTransport`, never an `AsyncHTTPTransport` instance, so it
    would silently do nothing. `unwrap` here is pointed at the actual
    `AsyncHTTPTransport` object (the transport passed in, always `_inner` in
    practice) whose class method the global patch touches.
    """
    from opentelemetry.instrumentation.utils import unwrap

    if hasattr(transport, "handle_async_request"):
        unwrap(transport, "handle_async_request")
    if hasattr(transport, "handle_request"):
        unwrap(transport, "handle_request")


def build_guarded_async_client(
    *,
    resolver: Resolver = default_resolve,
    timeout: httpx.Timeout | float | None = None,
    verify: ssl.SSLContext | str | bool = True,
) -> httpx.AsyncClient:
    """Build the per-request BYOK transport.

    `trust_env=False` and no `mounts`/`proxy` (T13): a proxy environment
    variable would otherwise route the "pinned-IP" connection through a proxy
    that re-resolves the hostname itself, silently voiding the pinning
    guarantee. `verify` is exposed only so tests can pin a private test CA;
    production callers should leave it at the default. This is the *only*
    sanctioned way to build a BYOK client — it carries both the SSRF guard
    (#284 Task 1) and the httpx-instrumentation exclusion (#284 Task 2,
    X3/P1-1, applied in `GuardedAsyncTransport.__init__`); a hand-rolled
    `httpx.AsyncClient` for BYOK traffic would have neither.
    """
    return httpx.AsyncClient(
        transport=GuardedAsyncTransport(resolver=resolver, verify=verify),
        trust_env=False,
        follow_redirects=False,
        timeout=timeout if timeout is not None else httpx.Timeout(30.0),
    )
