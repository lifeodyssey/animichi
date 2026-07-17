"""Vercel AI SDK envelope over the unified runtime boundary."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic_ai.ui.vercel_ai.response_types import (
    BaseChunk,
    DataChunk,
    DoneChunk,
    FinishChunk,
    FinishStepChunk,
    StartChunk,
    StartStepChunk,
)
from starlette.responses import Response, StreamingResponse

from agent.interfaces.routes._deps import (
    TrustedAuthContext,
    _get_runtime_api,
    _require_trusted_user,
)
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


def _last_user_text(messages: list[object]) -> str:
    for message in reversed(messages):
        text = _user_message_text(message)
        if text is not None:
            return text
    return ""


def _user_message_text(message: object) -> str | None:
    if not isinstance(message, dict) or message.get("role") != "user":
        return None
    parts = message.get("parts")
    if not isinstance(parts, list):
        return None
    values = [_text_part(part) for part in parts]
    return "".join(value for value in values if value is not None)


def _text_part(part: object) -> str | None:
    if not isinstance(part, dict) or part.get("type") != "text":
        return None
    value = part.get("text")
    return value if isinstance(value, str) else None


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


def _runtime_request(request: Request, body: dict[str, object]) -> PublicAPIRequest:
    return PublicAPIRequest(
        text=_last_user_text(_messages(body)),
        session_id=request.headers.get("x-session-id"),
        locale=_locale(request),
        selected_point_ids=_optional_ids(body, "selected_point_ids"),
        selected_candidate_ids=_optional_ids(body, "selected_candidate_ids"),
        clarification_id=_clarification_id(body),
        origin=_optional_string(body, "origin"),
        origin_lat=_optional_float(body, "origin_lat"),
        origin_lng=_optional_float(body, "origin_lng"),
    )


def _event(chunk: BaseChunk) -> str:
    return f"data: {chunk.encode(6)}\n\n"


async def _response_stream(response: PublicAPIResponse) -> AsyncIterator[str]:
    yield _event(StartChunk())
    yield _event(StartStepChunk())
    yield _event(DataChunk(type="data-response", data=response.model_dump(mode="json")))
    yield _event(FinishStepChunk())
    yield _event(FinishChunk(finish_reason="stop"))
    yield _event(DoneChunk())


@router.post("/chat")
async def handle_chat(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> Response:
    """Execute chat through RuntimeAPI; pending state is loaded by session ID."""
    api_request = _runtime_request(request, _decode_body(await request.body()))
    response = await _get_runtime_api(request).handle(api_request, user_id=auth.user_id)
    return StreamingResponse(
        _response_stream(response),
        media_type="text/event-stream",
        headers={"x-vercel-ai-ui-message-stream": "v1"},
    )
