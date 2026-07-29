"""Vercel AI SDK envelope over the unified runtime boundary."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Annotated, Literal, Never, cast

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.responses import Response, StreamingResponse

from agent.agents.byok_models import (
    ByokCredential,
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
    _require_trusted_user,
)
from agent.interfaces.routes.chat_stream import stream_chat
from agent.interfaces.schemas import PublicAPIRequest, PublicAPIResponse
from agent.interfaces.usage_metering import (
    ANON_BUDGET_EXHAUSTED_CODE,
    ANONYMOUS_USER_TYPE,
    anonymous_budget_verdict,
)

router = APIRouter(prefix="/v1", tags=["chat"])
Locale = Literal["ja", "zh", "en"]


def _locale(request: Request) -> Locale:
    value = request.headers.get("x-locale", "ja")
    return cast(Locale, value) if value in ("ja", "zh", "en") else "ja"


def _messages(body: dict[str, object]) -> list[object]:
    value = body.get("messages")
    if not isinstance(value, list):
        raise HTTPException(status_code=422, detail="messages must be a list")
    return value


def _last_user_text(messages: list[object], locale: Locale, max_chars: int) -> str:
    for message in reversed(messages):
        text = _user_message_text(message, locale, max_chars)
        if text is not None:
            return text
    return ""


def _user_message_text(message: object, locale: Locale, max_chars: int) -> str | None:
    if not isinstance(message, dict) or message.get("role") != "user":
        return None
    parts = message.get("parts")
    if not isinstance(parts, list):
        _reject_input("non_text_message", locale)
    values = [_text_part(part, locale) for part in parts]
    return _checked_length("".join(values), max_chars, locale)


def _text_part(part: object, locale: Locale) -> str:
    if not isinstance(part, dict) or part.get("type") != "text":
        _reject_input("non_text_message", locale)
    value = part.get("text")
    if not isinstance(value, str):
        _reject_input("non_text_message", locale)
    return value


def _checked_length(text: str, max_chars: int, locale: Locale) -> str:
    if len(text) > max_chars:
        _reject_input("message_too_long", locale)
    return text


def _reject_input(reason: InputError, locale: Locale) -> Never:
    message = build_input_error_message(reason, locale)
    raise HTTPException(status_code=422, detail=message)


def _optional_ids(body: dict[str, object], field: str) -> list[str] | None:
    value = body.get(field)
    if value is None:
        return None
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise HTTPException(status_code=422, detail=f"{field} must be a string list")
    return value


def _clarification_id(body: dict[str, object]) -> int | None:
    value = body.get("clarification_id")
    if value is None or isinstance(value, int) and not isinstance(value, bool):
        return value
    raise HTTPException(status_code=422, detail="clarification_id must be an integer")


def _optional_string(body: dict[str, object], field: str) -> str | None:
    value = body.get(field)
    if value is None or isinstance(value, str):
        return value
    raise HTTPException(status_code=422, detail=f"{field} must be a string")


def _optional_float(body: dict[str, object], field: str) -> float | None:
    value = body.get(field)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise HTTPException(status_code=422, detail=f"{field} must be a number")
    return float(value)


def _decode_body(raw: bytes) -> dict[str, object]:
    try:
        value: object = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=422, detail="invalid JSON body") from exc
    if not isinstance(value, dict):
        raise HTTPException(status_code=422, detail="request body must be an object")
    return value


def _runtime_request(
    request: Request, body: dict[str, object], max_chars: int
) -> PublicAPIRequest:
    locale = _locale(request)
    return PublicAPIRequest(
        text=_last_user_text(_messages(body), locale, max_chars),
        session_id=request.headers.get("x-session-id"),
        locale=locale,
        selected_point_ids=_optional_ids(body, "selected_point_ids"),
        selected_candidate_ids=_optional_ids(body, "selected_candidate_ids"),
        clarification_id=_clarification_id(body),
        origin=_optional_string(body, "origin"),
        origin_lat=_optional_float(body, "origin_lat"),
        origin_lng=_optional_float(body, "origin_lng"),
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
    """403 so the client falls into its D12 login-recovery state (issue #282).

    ``quota_resets_at`` is the next UTC day boundary, ISO 8601 with a literal
    ``Z`` — the frontend renders it in the visitor's local time instead of
    hard-coding a mismatched reset instant (review follow-up on #282). It
    lives under ``error.data``, matching the contract's
    ``AnonLimitErrorEnvelope`` (`packages/contract/src/error-registry.ts`):
    `code`/`message`/`action` are common to both anonymous-limit rejections,
    `data` carries only the quota-specific extra field, and the budget
    breaker's envelope (`_budget_exhausted_response` above) omits it entirely.
    """
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
    auth: TrustedAuthContext, byok: ByokCredential | None
) -> JSONResponse | None:
    """Reject a BYOK credential from an anonymous caller (#284 T3/T4).

    BYOK is login-gated by design (never honoured, never used to skip the
    anonymous budget) — an anonymous request presenting `X-BYOK-*` headers is
    refused outright rather than silently served either way.
    """
    if byok is None or auth.user_type != ANONYMOUS_USER_TYPE:
        return None
    return _error_response(
        "byok_requires_login", BYOK_REQUIRES_LOGIN_MESSAGE, status_code=403
    )


async def _resolve_byok_model(byok: ByokCredential | None) -> ByokModel | None:
    """Build the per-request guarded model before any streaming begins.

    Any structural/SSRF rejection here (`ByokError`) is a pre-stream 400 —
    the response has not been constructed yet, so `HTTPException` behaves
    normally through FastAPI's own exception handling.
    """
    if byok is None:
        return None
    try:
        return await build_byok_model(byok)
    except ByokError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc


def _chat_handler(
    runtime_api: RuntimeAPI,
    api_request: PublicAPIRequest,
    auth: TrustedAuthContext,
    byok_model: ByokModel | None,
) -> Callable[[OnStep], Awaitable[PublicAPIResponse]]:
    async def handler(on_step: OnStep) -> PublicAPIResponse:
        try:
            return await runtime_api.handle(
                api_request,
                model=byok_model.model if byok_model is not None else None,
                is_byok=byok_model is not None,
                user_id=auth.user_id,
                user_type=auth.user_type,
                on_step=on_step,
            )
        finally:
            # T3-AC8: closed even when the turn raises, whether the credential
            # was rejected or the turn failed for an unrelated reason.
            if byok_model is not None:
                await byok_model.client.aclose()

    return handler


@router.post("/chat", responses={422: {"description": "Invalid chat request"}})
async def handle_chat(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
    byok: Annotated[ByokCredential | None, Depends(_get_byok_credential)] = None,
) -> Response:
    """Stream chat as an AI SDK UI message stream with tool + data parts."""
    login_rejection = _byok_login_rejection(auth, byok)
    if login_rejection is not None:
        return login_rejection
    rejection = await _budget_rejection(request, auth)
    if rejection is None:
        rejection = await _quota_rejection(request, auth)
    if rejection is not None:
        return rejection
    settings = _get_settings_from_request(request)
    body = _decode_body(await request.body())
    api_request = _runtime_request(request, body, settings.message_max_chars)
    runtime_api = _get_runtime_api(request)
    await runtime_api.validate_session_owner(api_request.session_id, auth.user_id)
    byok_model = await _resolve_byok_model(byok)
    handler = _chat_handler(runtime_api, api_request, auth, byok_model)

    return StreamingResponse(
        stream_chat(handler),
        media_type="text/event-stream",
        headers={"x-vercel-ai-ui-message-stream": "v1"},
    )
