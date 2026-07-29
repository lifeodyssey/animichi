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
caller; (b) a fixed ≤5s wall-clock timeout so latency cannot distinguish
open-vs-filtered; (c) a ≤64 KiB response read cap so a hostile endpoint
cannot stream unbounded data into the container.
"""

from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
from typing import Annotated, Final, Literal

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError
from pydantic_ai.messages import BinaryContent
from pydantic_ai.models import Model

from agent.agents.byok_models import ByokError, build_byok_model
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

ProbeErrorCode = Literal["byok_credential_rejected", "provider_unreachable"]


@dataclass(frozen=True, slots=True)
class ProbeResult:
    vision: bool
    reachable: bool
    error_code: ProbeErrorCode | None


class _ProbeResponseTooLarge(Exception):
    """Raised when a probe response exceeds the 64 KiB read cap (c)."""


class _CappedResponseTransport(httpx.AsyncBaseTransport):
    """Wraps a transport to enforce the ≤64 KiB probe response cap.

    Applied only to the one-shot probe client — never to the shared BYOK
    chat transport (`egress_transport.GuardedAsyncTransport`), whose cap-free
    behaviour every other BYOK path still depends on.
    """

    def __init__(self, inner: httpx.AsyncBaseTransport) -> None:
        self._inner = inner

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self._inner.handle_async_request(request)
        content_length = response.headers.get("content-length")
        if (
            content_length is not None
            and int(content_length) > _PROBE_MAX_RESPONSE_BYTES
        ):
            await response.aclose()
            raise _ProbeResponseTooLarge()
        body = bytearray()
        async for chunk in response.aiter_bytes():
            body.extend(chunk)
            if len(body) > _PROBE_MAX_RESPONSE_BYTES:
                await response.aclose()
                raise _ProbeResponseTooLarge()
        await response.aclose()
        return httpx.Response(
            status_code=response.status_code,
            headers=response.headers,
            content=bytes(body),
            request=request,
        )

    async def aclose(self) -> None:
        await self._inner.aclose()


async def _validate_openai_compatible_egress(credential_base_url: str | None) -> None:
    """Pre-validate the caller-chosen `base_url` before spending a probe call.

    `build_byok_model` already re-validates internally (T1/T3), so this is a
    deliberate early, separately-coded check: it lets the route return the
    dedicated `egress_blocked` code (T5-AC4) rather than `build_byok_model`'s
    generic `invalid_request`, without changing that shared module's error
    taxonomy for every other BYOK caller.
    """
    if credential_base_url is None:
        return
    await validate_base_url(credential_base_url)


async def _run_probe(model: Model) -> ProbeResult:
    png = base64.b64decode(_PROBE_PNG_B64)
    probe_agent: Agent[None, str] = Agent(
        model, output_type=str, name="byok_vision_probe"
    )
    try:
        async with asyncio.timeout(_PROBE_TIMEOUT_SECONDS):
            await probe_agent.run(
                [_PROBE_PROMPT, BinaryContent(data=png, media_type="image/png")]
            )
    except ModelHTTPError as exc:
        if exc.status_code in (401, 403):
            return ProbeResult(
                vision=False, reachable=False, error_code="byok_credential_rejected"
            )
        return ProbeResult(vision=False, reachable=True, error_code=None)
    except (
        TimeoutError,
        httpx.TransportError,
        EgressBlocked,
        _ProbeResponseTooLarge,
        OSError,
        ModelAPIError,
    ):
        return ProbeResult(
            vision=False, reachable=False, error_code="provider_unreachable"
        )
    return ProbeResult(vision=True, reachable=True, error_code=None)


def _probe_response(result: ProbeResult) -> JSONResponse:
    return JSONResponse(
        status_code=200,
        content={
            "vision": result.vision,
            "reachable": result.reachable,
            "error_code": result.error_code,
        },
    )


@router.post("/probe")
async def handle_byok_probe(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    """Validate a BYOK credential and detect vision support in one call."""
    if auth.user_type == ANONYMOUS_USER_TYPE and _has_byok_headers(request):
        return _error_response(
            "byok_requires_login", "BYOKを使うにはログインが必要です。", status_code=403
        )
    credential = _get_byok_credential(request)
    if credential is None:
        return _error_response(
            "invalid_request", "X-BYOK-* headers are required.", status_code=400
        )
    try:
        if credential.provider == "openai-compatible":
            await _validate_openai_compatible_egress(credential.base_url)
        byok_model = await build_byok_model(credential)
    except EgressBlocked:
        return _error_response(
            "egress_blocked", "base_url failed egress validation.", status_code=400
        )
    except ByokError as exc:
        return _error_response("invalid_request", exc.message, status_code=400)
    try:
        byok_model.client._transport = _CappedResponseTransport(
            byok_model.client._transport
        )
        result = await _run_probe(byok_model.model)
    finally:
        await byok_model.client.aclose()
    return _probe_response(result)
