"""Vercel AI SDK envelope over the unified runtime boundary."""

from __future__ import annotations

import json
from typing import Annotated, Literal, Never, cast

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.responses import Response, StreamingResponse

from agent.agents.error_messages import InputError, build_input_error_message
from agent.agents.runtime_deps import OnStep
from agent.interfaces.routes._deps import (
    TrustedAuthContext,
    _get_runtime_api,
    _get_settings_from_request,
    _require_trusted_user,
)
from agent.interfaces.routes.chat_stream import stream_chat
from agent.interfaces.schemas import PublicAPIRequest, PublicAPIResponse

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


@router.post("/chat", responses={422: {"description": "Invalid chat request"}})
async def handle_chat(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> Response:
    """Stream chat as an AI SDK UI message stream with tool + data parts."""
    settings = _get_settings_from_request(request)
    body = _decode_body(await request.body())
    api_request = _runtime_request(request, body, settings.message_max_chars)
    runtime_api = _get_runtime_api(request)
    await runtime_api.validate_session_owner(api_request.session_id, auth.user_id)

    async def handler(on_step: OnStep) -> PublicAPIResponse:
        return await runtime_api.handle(
            api_request, user_id=auth.user_id, on_step=on_step
        )

    return StreamingResponse(
        stream_chat(handler),
        media_type="text/event-stream",
        headers={"x-vercel-ai-ui-message-stream": "v1"},
    )
