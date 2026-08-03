"""Vercel AI SDK envelope over the unified runtime boundary."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Annotated, Never

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.background import BackgroundTask
from starlette.responses import Response, StreamingResponse

from agent.agents.byok_models import (
    ByokError,
    ByokModel,
    build_byok_model,
)
from agent.agents.error_messages import InputError, build_input_error_message
from agent.agents.runtime_deps import OnStep
from agent.interfaces.anon_quota import (
    ANON_QUOTA_EXHAUSTED_CODE,
    QUOTA_RESETS_AT_FIELD,
    anonymous_quota_verdict,
)
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.routes._deps import (
    TrustedAuthContext,
    _error_response,
    _get_byok_credential,
    _get_db_from_request,
    _get_runtime_api,
    _get_settings_from_request,
    _get_trusted_auth_context,
    _has_byok_headers,
    _require_trusted_user,
)
from agent.interfaces.routes.chat_body import (
    ChatBody,
    ChatBodyRoute,
    ChatMessageError,
    Locale,
    request_locale,
)
from agent.interfaces.routes.chat_stream import stream_chat
from agent.interfaces.schemas import PublicAPIRequest, PublicAPIResponse
from agent.interfaces.usage_metering import (
    ANON_BUDGET_EXHAUSTED_CODE,
    ANONYMOUS_USER_TYPE,
    anonymous_budget_verdict,
)

_PREFLIGHT_STATE = "chat_body_preflight_complete"


def _chat_auth_from_request(request: Request) -> TrustedAuthContext:
    auth = _get_trusted_auth_context(
        request.headers.get("x-user-id"),
        request.headers.get("x-user-type"),
        request.headers.get("authorization"),
    )
    return _require_trusted_user(auth)


def _chat_auth(request: Request) -> TrustedAuthContext:
    auth = getattr(request.state, "chat_auth", None)
    return (
        auth
        if isinstance(auth, TrustedAuthContext)
        else _chat_auth_from_request(request)
    )


def _preflight_complete(request: Request) -> bool:
    return getattr(request.state, _PREFLIGHT_STATE, False) is True


def _reject_input(reason: InputError, locale: Locale) -> Never:
    message = build_input_error_message(reason, locale)
    raise HTTPException(status_code=422, detail=message)


def _chat_text(body: ChatBody, limit: int, locale: Locale) -> str:
    try:
        return body.last_user_text(limit)
    except ChatMessageError as exc:
        _reject_input(exc.reason, locale)


def _runtime_request(request: Request, body: ChatBody, limit: int) -> PublicAPIRequest:
    locale = request_locale(request)
    text = _chat_text(body, limit, locale)
    return PublicAPIRequest(
        text=text,
        session_id=request.headers.get("x-session-id"),
        locale=locale,
        **body.model_dump(exclude={"messages"}),
    )


BUDGET_EXHAUSTED_MESSAGE = (
    "今日はここまで。ログインすると続きから一緒に旅の計画を立てられるよ。"
)


def _budget_exhausted_response() -> JSONResponse:
    """403 so the client falls into its login-recovery state, not a hard error."""
    error = {
        "code": ANON_BUDGET_EXHAUSTED_CODE,
        "message": BUDGET_EXHAUSTED_MESSAGE,
        "action": "login",
    }
    return JSONResponse(status_code=403, content={"error": error})


async def _budget_rejection(
    request: Request, auth: TrustedAuthContext
) -> JSONResponse | None:
    """Container-ingress circuit breaker (X4): the authoritative budget check.

    Only anonymous callers are gated — logged-in traffic never reaches the
    ``daily_usage`` read, let alone the rejection.
    """
    if auth.user_type != ANONYMOUS_USER_TYPE:
        return None
    settings = _get_settings_from_request(request)
    verdict = await anonymous_budget_verdict(
        _get_db_from_request(request),
        budget_usd=settings.anon_daily_cost_budget_usd,
    )
    return _budget_exhausted_response() if verdict.exhausted else None


QUOTA_EXHAUSTED_MESSAGE = "今日はここまで・ログインすると続けられるよ。"


def _quota_exhausted_response(resets_at: datetime) -> JSONResponse:
    """Return the D12 login recovery envelope with its next UTC reset."""
    error = {
        "code": ANON_QUOTA_EXHAUSTED_CODE,
        "message": QUOTA_EXHAUSTED_MESSAGE,
        "action": "login",
        "data": {QUOTA_RESETS_AT_FIELD: resets_at.strftime("%Y-%m-%dT%H:%M:%SZ")},
    }
    return JSONResponse(status_code=403, content={"error": error})


async def _quota_rejection(
    request: Request, auth: TrustedAuthContext
) -> JSONResponse | None:
    """Container-ingress per-identity quota check (issue #282, S1.10).

    Runs only when the shared anonymous budget (D11, above) has not already
    rejected the turn: the global dollar breaker is the more severe, systemic
    concern and wins ties over one visitor's own message ceiling. Only
    anonymous callers are gated — logged-in traffic is never metered here.
    """
    if auth.user_type != ANONYMOUS_USER_TYPE or auth.user_id is None:
        return None
    settings = _get_settings_from_request(request)
    verdict = await anonymous_quota_verdict(
        _get_db_from_request(request),
        anon_id=auth.user_id,
        quota=settings.anon_daily_message_quota,
    )
    return _quota_exhausted_response(verdict.resets_at) if verdict.exhausted else None


BYOK_REQUIRES_LOGIN_MESSAGE = "BYOKを使うにはログインが必要です。"


def _byok_login_rejection(
    request: Request, auth: TrustedAuthContext
) -> JSONResponse | None:
    """Reject anonymous BYOK presence before parsing its credential shape."""
    if auth.user_type != ANONYMOUS_USER_TYPE or not _has_byok_headers(request):
        return None
    return _error_response(
        "byok_requires_login", BYOK_REQUIRES_LOGIN_MESSAGE, status_code=403
    )


async def _body_preflight(
    request: Request, auth: TrustedAuthContext
) -> JSONResponse | None:
    rejection = _byok_login_rejection(request, auth)
    if rejection is not None:
        return rejection
    return await _budget_rejection(request, auth)


async def _resolve_byok_model(request: Request) -> ByokModel | None:
    """Parse and build the per-request guarded model before streaming begins.

    Called directly from the route body (P1-1) — never via `Depends()` — so
    the credential is never resolved into a FastAPI endpoint parameter that
    `logfire.instrument_fastapi()` would otherwise capture into
    `fastapi.arguments.values`.

    Any rejection here is a pre-stream 4xx: the response has not been
    constructed yet, so a raised `HTTPException` behaves normally through
    FastAPI's own exception handling. `ByokError` (a client-input problem)
    maps to its own code; anything else raised during provider/client
    construction (P2) is still the caller's malformed input from this
    boundary's point of view, so it maps to the same `invalid_request` shape
    rather than an unhandled 500.
    """
    byok = _get_byok_credential(request)
    if byok is None:
        return None
    try:
        return await build_byok_model(byok)
    except ByokError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail="Unable to construct the BYOK model."
        ) from exc


def _chat_handler(
    runtime_api: RuntimeAPI,
    api_request: PublicAPIRequest,
    auth: TrustedAuthContext,
    byok_model: ByokModel | None,
) -> Callable[[OnStep], Awaitable[PublicAPIResponse]]:
    async def handler(on_step: OnStep) -> PublicAPIResponse:
        return await runtime_api.handle(
            api_request,
            model=byok_model.model if byok_model is not None else None,
            is_byok=byok_model is not None,
            user_id=auth.user_id,
            user_type=auth.user_type,
            on_step=on_step,
        )

    return handler


async def _route_preflight(request: Request) -> JSONResponse | None:
    auth = _chat_auth_from_request(request)
    rejection = await _body_preflight(request, auth)
    if rejection is not None:
        return rejection
    request.state.chat_auth = auth
    setattr(request.state, _PREFLIGHT_STATE, True)
    return None


class ChatRoute(ChatBodyRoute):
    async def preflight(self, request: Request) -> Response | None:
        return await _route_preflight(request)


router = APIRouter(prefix="/v1", tags=["chat"], route_class=ChatRoute)


@router.post("/chat", responses={422: {"description": "Invalid chat request"}})
async def handle_chat(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_chat_auth)],
    body: ChatBody,
) -> Response:
    """Stream chat as an AI SDK UI message stream with tool + data parts."""
    rejection = (
        None if _preflight_complete(request) else await _body_preflight(request, auth)
    )
    if rejection is not None:
        return rejection
    settings = _get_settings_from_request(request)
    api_request = _runtime_request(request, body, settings.message_max_chars)
    runtime_api = _get_runtime_api(request)
    await runtime_api.validate_session_owner(api_request.session_id, auth.user_id)
    rejection = await _quota_rejection(request, auth)
    if rejection is not None:
        return rejection
    byok_model = await _resolve_byok_model(request)
    handler = _chat_handler(runtime_api, api_request, auth, byok_model)

    response = StreamingResponse(
        stream_chat(handler),
        media_type="text/event-stream",
        headers={"x-vercel-ai-ui-message-stream": "v1"},
    )
    if byok_model is not None:
        # T3-AC8 (P2): cleanup via `BackgroundTask` rather than a
        # try/finally inside the streaming handler — Starlette guarantees
        # this runs after the response completes, including on a client
        # disconnect mid-stream, decoupled from whether the body iterator
        # itself ever got to run to completion.
        response.background = BackgroundTask(byok_model.client.aclose)
    return response
