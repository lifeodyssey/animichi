"""`POST /v1/byok/probe` — BYOK credential validation + vision-capability
probe (#284 Task 5, spec D5).

Deliberately dual-purpose (OQ-2 ruling): a single minimal call both validates
the caller's credential (one upstream request) and detects whether the
configured model accepts an image part, so configuring a key costs the user
exactly one probe request instead of two.

Authenticated route only (login-gated like the rest of BYOK): not listed in
`workers/edge/app.ts`'s `ANON_V1`, so an unauthenticated caller is rejected at the
edge with a 401 before this ever runs (T5-AC5). The container repeats the
login gate anyway (defense in depth, mirrors `chat.py::_byok_login_rejection`)
in case this route is ever reached directly.

Containment (rev4, P2-1): the probe is otherwise a reachability oracle for a
caller-chosen endpoint, so three constraints apply beyond the SSRF guard
itself: (a) the failure taxonomy collapses to `provider_unreachable` except
for the two auth outcomes (401/403), which alone are actionable for the
caller — review follow-up (#479 P1-2/P2-1): only 400/422 mean "reachable but
this model rejects the image part"; every OTHER HTTP status (404/429/5xx)
also collapses to `provider_unreachable`, and the whole model call is
wrapped in a bare `except Exception` so nothing here escapes to the generic
500 handler, which would otherwise be a FOURTH distinguishable outcome; (b) a
fixed ≤5s wall-clock timeout so latency cannot distinguish open-vs-filtered;
(c) a ≤64 KiB response read cap so a hostile endpoint cannot stream unbounded
data into the container.

Residual risk, accepted (#479 review, not fixed here): (b)'s fixed ceiling
bounds *how long* a caller can wait, but the concrete failure latency below
that ceiling still differs by cause (a local connection-refused typically
resolves in single-digit milliseconds; a black-holed/filtered destination
consumes the full timeout) — a patient attacker can still time the response
to infer open-vs-filtered-vs-connection-refused across many probes. Tracked
as a documented accepted residual rather than silently declared "solved" —
see issue #481 for a constant-time-response mitigation.
"""

from __future__ import annotations

import asyncio
from typing import Annotated, Final

import httpx
import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from animichi.agents.byok_models import (
    ByokCredential,
    ByokError,
    ByokModel,
    build_byok_model,
)
from animichi.agents.byok_probe import ProbeResult, probe_byok_model
from animichi.infrastructure.egress_errors import EgressBlocked
from animichi.infrastructure.egress_guard import validate_base_url
from animichi.interfaces.routes._deps import (
    TrustedAuthContext,
    _error_response,
    _get_byok_credential,
    _has_byok_headers,
    _require_trusted_user,
)
from animichi.interfaces.usage_metering import is_anonymous_identity

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/v1/byok", tags=["byok"])

#: (b) — a fixed ceiling on the whole probe, independent of any single
#: client/SDK's own connect/read timeout, so latency cannot leak
#: open-vs-filtered for a caller-chosen endpoint.
_PROBE_TIMEOUT_SECONDS: Final[float] = 5.0

#: (c) — a hostile endpoint must not be able to stream unbounded data into
#: the container just because it answered.
_PROBE_MAX_RESPONSE_BYTES: Final[int] = 64 * 1024

_PROBE_PROMPT = "reply with the single word OK"

#: A minimal, valid, fully-transparent 1x1 PNG (67 bytes decoded) — the
#: smallest well-formed image that exercises a real "does this model accept
#: an image part" round trip.
_PROBE_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


#: Only these two HTTP statuses are actionable for the caller (they can fix
#: their key); everything else collapses to `provider_unreachable` (a).
#: The provider answered but rejected the image part itself — reachable,
#: just no vision support (review follow-up, #479 P2-1: narrowed from "any
#: non-401/403 status" to exactly these two, so a 404/429/5xx doesn't
#: masquerade as a legitimate "no vision" answer).
class _ProbeResponseTooLarge(Exception):
    """Raised when a probe response exceeds the 64 KiB read cap (c)."""


class _RouteRejection(Exception):
    """Carries a pre-built error `JSONResponse` out of model resolution."""

    def __init__(self, response: JSONResponse) -> None:
        self.response = response


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
    if content_length is not None and int(content_length) > _PROBE_MAX_RESPONSE_BYTES:
        raise _ProbeResponseTooLarge()


async def _read_capped_body(response: httpx.Response) -> bytes:
    """Enforce the cap on the actual byte stream too — a hostile endpoint
    could omit or lie about `Content-Length` and still try to stream
    unbounded data."""
    body = bytearray()
    async for chunk in response.aiter_bytes():
        body.extend(chunk)
        if len(body) > _PROBE_MAX_RESPONSE_BYTES:
            await response.aclose()
            raise _ProbeResponseTooLarge()
    await response.aclose()
    return bytes(body)


class _CappedResponseTransport(httpx.AsyncBaseTransport):
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


def _unreachable_result() -> ProbeResult:
    return ProbeResult(
        has_vision=False, reachable=False, error_code="provider_unreachable"
    )


def _probe_response(result: ProbeResult) -> JSONResponse:
    logger.info(
        "byok_probe_completed",
        vision=result.has_vision,
        reachable=result.reachable,
        error_code=result.error_code,
    )
    return JSONResponse(
        status_code=200,
        content={
            "vision": result.has_vision,
            "reachable": result.reachable,
            "error_code": result.error_code,
        },
    )


def _probe_login_rejection(
    auth: TrustedAuthContext, request: Request
) -> JSONResponse | None:
    """Mirrors `chat.py::_byok_login_rejection` — including its fix (#741).

    Routes through `is_anonymous_identity` rather than a bare
    `user_type != ANONYMOUS_USER_TYPE` check: an `anon_`-prefixed
    `X-User-Id` with a missing or mistyped `X-User-Type` is anonymous by the
    ID convention too, and a literal check here would let that caller reach
    the real credential-probing model call.
    """
    if not is_anonymous_identity(auth.user_id, auth.user_type) or not _has_byok_headers(
        request
    ):
        return None
    return _error_response(
        "byok_requires_login", "BYOKを使うにはログインが必要です。", status_code=403
    )


async def _validate_egress_for_probe(credential: ByokCredential) -> None:
    """Pre-validate a caller-chosen `base_url` before spending a probe call.

    Only the `openai-compatible` family carries a caller-chosen `base_url`
    at all (`parse_byok_credential` enforces `None` for the other two
    families, so this branch is never reached for them — no dead
    `None`-check here). `build_byok_model` re-validates internally (T1/T3) —
    this earlier, separately-coded check exists only so the route can answer
    with the dedicated `egress_blocked` code (T5-AC4) instead of
    `build_byok_model`'s generic `invalid_request`.
    """
    if credential.provider != "openai-compatible":
        return
    if credential.base_url is None:
        # Structurally unreachable — `parse_byok_credential` requires a
        # `base_url` for this family (`_require_base_url`) — but this is a
        # security-relevant boundary, so it fails loudly rather than passing
        # `None` into `validate_base_url` and silently short-circuiting.
        raise RuntimeError(
            "openai-compatible credential is missing its required base_url."
        )
    await validate_base_url(credential.base_url)


def _egress_blocked_rejection() -> _RouteRejection:
    response = _error_response(
        "egress_blocked", "base_url failed egress validation.", status_code=400
    )
    return _RouteRejection(response)


def _byok_error_rejection(exc: ByokError) -> _RouteRejection:
    return _RouteRejection(
        _error_response("invalid_request", exc.message, status_code=400)
    )


async def _resolve_probe_model(credential: ByokCredential) -> ByokModel:
    try:
        await _validate_egress_for_probe(credential)
        return await build_byok_model(
            credential, transport_wrapper=_CappedResponseTransport
        )
    except EgressBlocked as exc:
        raise _egress_blocked_rejection() from exc
    except ByokError as exc:
        raise _byok_error_rejection(exc) from exc


@router.post("/probe")
async def handle_byok_probe(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    """Validate a BYOK credential and detect vision support in one call."""
    login_rejection = _probe_login_rejection(auth, request)
    if login_rejection is not None:
        return login_rejection
    credential = _get_byok_credential(request)
    if credential is None:
        return _error_response(
            "invalid_request", "X-BYOK-* headers are required.", status_code=400
        )
    byok_model = None
    try:
        async with asyncio.timeout(_PROBE_TIMEOUT_SECONDS):
            byok_model = await _resolve_probe_model(credential)
            result = await probe_byok_model(byok_model.model)
    except _RouteRejection as rejection:
        return rejection.response
    except TimeoutError:
        return _probe_response(_unreachable_result())
    finally:
        if byok_model is not None:
            await byok_model.client.aclose()
    return _probe_response(result)
