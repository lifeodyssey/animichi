"""Connect-time SSRF enforcement transport for BYOK egress (#284 Task 1).

`GuardedAsyncTransport` independently re-runs `egress_guard.validate_base_url`
at connect time (its own single resolution), pins the socket to the address
*that* call validated, preserves TLS hostname verification via
`sni_hostname`, and refuses every 3xx response. This is what closes the
TOCTOU/DNS-rebinding window: httpcore never resolves the hostname itself,
because by the time it sees the request the host has already been rewritten
to a validated IP literal.

`CappedResponseTransport` is the second, complementary guard (#284 Task 5):
a ≤64 KiB response-size cap layered over a `GuardedAsyncTransport` via
`build_guarded_async_client(transport_wrapper=...)`, so a hostile BYOK
endpoint cannot stream unbounded data into the container just because it
answered.
"""

from __future__ import annotations

import ssl
from collections.abc import Callable
from typing import Final

import httpx

from animichi.infrastructure.egress_errors import EgressBlocked, EgressBlockReason
from animichi.infrastructure.egress_guard import (
    Resolver,
    ValidatedEndpoint,
    default_resolve,
    validate_base_url,
)

#: The ≤64 KiB response read cap for the one-shot BYOK probe (Task 5 (c)).
PROBE_MAX_RESPONSE_BYTES: Final[int] = 64 * 1024


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


TransportWrapper = Callable[[httpx.AsyncBaseTransport], httpx.AsyncBaseTransport]


def build_guarded_async_client(
    *,
    resolver: Resolver = default_resolve,
    timeout: httpx.Timeout | float | None = None,
    verify: ssl.SSLContext | str | bool = True,
    transport_wrapper: TransportWrapper | None = None,
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

    `transport_wrapper` (review follow-up, #479 P2): applied at construction
    time, never as a post-hoc `client._transport = ...` reassignment — the
    probe route (#284 Task 5) uses this to install its response-size cap
    *before* the client is ever handed to a caller, so there is no window
    where an unwrapped, cap-free transport exists.
    """
    transport: httpx.AsyncBaseTransport = GuardedAsyncTransport(
        resolver=resolver, verify=verify
    )
    if transport_wrapper is not None:
        transport = transport_wrapper(transport)
    return httpx.AsyncClient(
        transport=transport,
        trust_env=False,
        follow_redirects=False,
        timeout=timeout if timeout is not None else httpx.Timeout(30.0),
    )


class _ProbeResponseTooLarge(Exception):
    """Raised when a probe response exceeds the 64 KiB read cap."""


def _rebuild_response(
    original: httpx.Response, content: bytes, request: httpx.Request
) -> httpx.Response:
    return httpx.Response(
        status_code=original.status_code,
        headers=original.headers,
        content=content,
        request=request,
    )


def _reject_if_content_length_too_large(response: httpx.Response) -> None:
    content_length = response.headers.get("content-length")
    if content_length is not None and int(content_length) > PROBE_MAX_RESPONSE_BYTES:
        raise _ProbeResponseTooLarge()


async def _read_capped_body(response: httpx.Response) -> bytes:
    """Enforce the cap on the actual byte stream too — a hostile endpoint
    could omit or lie about `Content-Length` and still try to stream
    unbounded data."""
    body = bytearray()
    async for chunk in response.aiter_bytes():
        body.extend(chunk)
        if len(body) > PROBE_MAX_RESPONSE_BYTES:
            await response.aclose()
            raise _ProbeResponseTooLarge()
    await response.aclose()
    return bytes(body)


class CappedResponseTransport(httpx.AsyncBaseTransport):
    """Wraps a transport to enforce the ≤64 KiB probe response cap.

    Installed at client-construction time via `build_byok_model`'s
    `transport_wrapper` (review follow-up, #479 P2) — never as a post-hoc
    `client._transport = ...` reassignment, so there is no window where an
    unwrapped, cap-free transport exists. Applied only to the one-shot probe
    client — never to the shared BYOK chat transport, whose cap-free
    behaviour every other BYOK path still depends on.
    """

    def __init__(self, inner: httpx.AsyncBaseTransport) -> None:
        self._inner = inner

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self._inner.handle_async_request(request)
        _reject_if_content_length_too_large(response)
        content = await _read_capped_body(response)
        return _rebuild_response(response, content, request)

    async def aclose(self) -> None:
        await self._inner.aclose()
