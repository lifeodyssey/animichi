"""`POST /v1/byok/probe` — BYOK credential validation + vision-capability
probe (#284 Task 5, spec D5).

Deliberately dual-purpose (OQ-2 ruling): a single minimal call both validates
the caller's credential (one upstream request) and detects whether the
configured model accepts an image part, so configuring a key costs the user
exactly one probe request instead of two.

Authenticated route only (login-gated like the rest of BYOK): not listed in
`worker/app.ts`'s `ANON_V1`, so an unauthenticated caller is rejected at the
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
import base64
from dataclasses import dataclass
from typing import Annotated, Final, Literal

import httpx
import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import BinaryContent, UserContent
from pydantic_ai.models import Model

from agent.agents.byok_models import (
    ByokCredential,
    ByokError,
    ByokModel,
    build_byok_model,
)
from agent.infrastructure.egress_errors import EgressBlocked
from agent.infrastructure.egress_guard import validate_base_url
from agent.interfaces.routes._deps import (
    TrustedAuthContext,
    _error_response,
    _get_byok_credential,
    _has_byok_headers,
    _require_trusted_user,
)
from agent.interfaces.usage_metering import ANONYMOUS_USER_TYPE

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
_CREDENTIAL_REJECTED_STATUSES: Final[frozenset[int]] = frozenset({401, 403})
#: The provider answered but rejected the image part itself — reachable,
#: just no vision support (review follow-up, #479 P2-1: narrowed from "any
#: non-401/403 status" to exactly these two, so a 404/429/5xx doesn't
#: masquerade as a legitimate "no vision" answer).
_VISION_UNSUPPORTED_STATUSES: Final[frozenset[int]] = frozenset({400, 422})

ProbeErrorCode = Literal["byok_credential_rejected", "provider_unreachable"]


@dataclass(frozen=True, slots=True)
class ProbeResult:
    vision: bool
    reachable: bool
    error_code: ProbeErrorCode | None


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


def _probe_message() -> list[UserContent]:
    png = base64.b64decode(_PROBE_PNG_B64)
    return [_PROBE_PROMPT, BinaryContent(data=png, media_type="image/png")]


def _unreachable_result() -> ProbeResult:
    return ProbeResult(vision=False, reachable=False, error_code="provider_unreachable")


def _classify_model_http_error(exc: ModelHTTPError) -> ProbeResult:
    if exc.status_code in _CREDENTIAL_REJECTED_STATUSES:
        return ProbeResult(
            vision=False, reachable=False, error_code="byok_credential_rejected"
        )
    if exc.status_code in _VISION_UNSUPPORTED_STATUSES:
        return ProbeResult(vision=False, reachable=True, error_code=None)
    return _unreachable_result()


async def _run_probe(model: Model) -> ProbeResult:
    """Run the one-shot probe turn. Never lets an exception escape: every
    branch below returns a `ProbeResult` — see the module docstring's (a)."""
    probe_agent: Agent[None, str] = Agent(
        model, output_type=str, name="byok_vision_probe"
    )
    try:
        async with asyncio.timeout(_PROBE_TIMEOUT_SECONDS):
            await probe_agent.run(_probe_message())
    except ModelHTTPError as exc:
        return _classify_model_http_error(exc)
    except asyncio.CancelledError:
        # #479 round-3 review follow-up (Fable): a genuine cancellation —
        # the CI runner tearing down the surrounding test/request, not a
        # provider reachability outcome — must propagate, never be folded
        # into `provider_unreachable` by the broad clause below. Explicit
        # even though `CancelledError` is a `BaseException`, not an
        # `Exception`, in this Python version: some paths through
        # pydantic-ai's `AsyncExitStack`/task-group cleanup can surface a
        # cancellation as a *different*, `Exception`-derived error raised
        # during that cleanup (e.g. from closing an httpx transport mid
        # teardown) rather than the raw `CancelledError` itself, so this
        # is defense-in-depth on the one case we CAN identify directly —
        # never treat "the ground is shifting under us" as "the provider
        # is unreachable".
        raise
    except Exception:
        # Bare `except Exception` (#479 P1-2 review follow-up), not a curated
        # tuple: a connectivity failure, a timeout, the response-size cap, or
        # any other model/provider error must all collapse to the same
        # opaque outcome. Letting any of them escape here would 500 through
        # the app's generic exception handler — a fourth, distinguishable
        # response shape a caller could use to fingerprint a public
        # non-LLM service behind the probed endpoint.
        logger.info("byok_probe_unreachable", exc_info=True)
        return _unreachable_result()
    return ProbeResult(vision=True, reachable=True, error_code=None)


def _probe_response(result: ProbeResult) -> JSONResponse:
    logger.info(
        "byok_probe_completed",
        vision=result.vision,
        reachable=result.reachable,
        error_code=result.error_code,
    )
    return JSONResponse(
        status_code=200,
        content={
            "vision": result.vision,
            "reachable": result.reachable,
            "error_code": result.error_code,
        },
    )


def _probe_login_rejection(
    auth: TrustedAuthContext, request: Request
) -> JSONResponse | None:
    if auth.user_type != ANONYMOUS_USER_TYPE or not _has_byok_headers(request):
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
    try:
        byok_model = await _resolve_probe_model(credential)
    except _RouteRejection as rejection:
        return rejection.response
    try:
        result = await _run_probe(byok_model.model)
    finally:
        await byok_model.client.aclose()
    return _probe_response(result)
