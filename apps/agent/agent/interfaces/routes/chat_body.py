"""Declarative request models for the Vercel AI SDK chat envelope."""

from __future__ import annotations

from abc import abstractmethod
from collections.abc import Awaitable, Callable, Coroutine, Mapping
from dataclasses import dataclass
from typing import Annotated, Literal, cast

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import (
    BaseModel,
    ConfigDict,
    Discriminator,
    StrictFloat,
    StrictInt,
    StrictStr,
    Tag,
    ValidationError,
    field_validator,
)
from starlette.responses import Response

from agent.agents.error_messages import InputError, build_input_error_message

Locale = Literal["ja", "zh", "en"]
RouteHandler = Callable[[Request], Coroutine[object, object, Response]]
Preflight = Callable[[Request], Awaitable[Response | None]]
_JSON_CONTENT_TYPE = (b"content-type", b"application/json")
_FIELD_ERRORS = {
    "messages": "messages must be a list",
    "selected_point_ids": "selected_point_ids must be a string list",
    "selected_candidate_ids": "selected_candidate_ids must be a string list",
    "clarification_id": "clarification_id must be an integer",
    "origin": "origin must be a string",
    "origin_lat": "origin_lat must be a number",
    "origin_lng": "origin_lng must be a number",
}


def request_locale(request: Request) -> Locale:
    value = request.headers.get("x-locale", "ja")
    return cast(Locale, value) if value in ("ja", "zh", "en") else "ja"


@dataclass(frozen=True)
class ChatMessageError(Exception):
    reason: InputError


class AISDKPart(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: object | None = None
    text: object | None = None


class AISDKTextPart(BaseModel):
    model_config = ConfigDict(extra="ignore", from_attributes=True)

    type: Literal["text"]
    text: StrictStr


def _part_tag(value: object) -> Literal["part", "raw"]:
    return "part" if isinstance(value, Mapping) else "raw"


ChatPart = Annotated[
    Annotated[AISDKPart, Tag("part")] | Annotated[object, Tag("raw")],
    Discriminator(_part_tag),
]


def _text_value(part: ChatPart) -> str:
    if not isinstance(part, AISDKPart):
        raise ChatMessageError("non_text_message")
    try:
        return AISDKTextPart.model_validate(part, from_attributes=True).text
    except ValidationError as exc:
        raise ChatMessageError("non_text_message") from exc


class AISDKUserMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    role: Literal["user"]
    parts: list[ChatPart]

    def text(self, limit: int) -> str:
        values: list[str] = []
        total = 0
        for part in self.parts:
            value = _text_value(part)
            total += len(value)
            if total > limit:
                raise ChatMessageError("message_too_long")
            values.append(value)
        return "".join(values)


class AISDKMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    role: object | None = None
    parts: object | None = None


def _is_user_message(value: object) -> bool:
    return isinstance(value, Mapping) and value.get("role") == "user"


def _last_user_index(messages: list[object]) -> int | None:
    for index in range(len(messages) - 1, -1, -1):
        if _is_user_message(messages[index]):
            return index
    return None


def _prepared_message(value: object, index: int, last_user: int) -> object:
    if index == last_user or not _is_user_message(value):
        return value
    return AISDKMessage.model_validate(value)


def _prepared_messages(value: object) -> object:
    if not isinstance(value, list):
        return value
    last_user = _last_user_index(value)
    if last_user is None:
        return value
    return [
        _prepared_message(item, index, last_user) for index, item in enumerate(value)
    ]


def _message_tag(value: object) -> Literal["user", "ignored", "raw"]:
    if isinstance(value, AISDKMessage):
        return "ignored"
    if isinstance(value, Mapping):
        return "user" if value.get("role") == "user" else "ignored"
    return "raw"


ChatMessage = Annotated[
    Annotated[AISDKUserMessage, Tag("user")]
    | Annotated[AISDKMessage, Tag("ignored")]
    | Annotated[object, Tag("raw")],
    Discriminator(_message_tag),
]


class ChatBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    messages: list[ChatMessage]
    selected_point_ids: list[StrictStr] | None = None
    selected_candidate_ids: list[StrictStr] | None = None
    clarification_id: StrictInt | None = None
    origin: StrictStr | None = None
    origin_lat: StrictFloat | None = None
    origin_lng: StrictFloat | None = None

    @field_validator("messages", mode="before")
    @classmethod
    def preserve_lazy_history(cls, value: object) -> object:
        return _prepared_messages(value)

    @field_validator("origin_lat", "origin_lng", mode="before")
    @classmethod
    def widen_integer_coordinates(cls, value: object) -> object:
        if isinstance(value, int) and not isinstance(value, bool):
            return float(value)
        return value

    def last_user_text(self, limit: int) -> str:
        for message in reversed(self.messages):
            if isinstance(message, AISDKUserMessage):
                return message.text(limit)
        return ""


def _first_error(exc: RequestValidationError) -> Mapping[object, object]:
    return cast(Mapping[object, object], exc.errors()[0])


def _error_kind(error: Mapping[object, object]) -> str:
    kind = error.get("type")
    return kind if isinstance(kind, str) else ""


def _error_field(error: Mapping[object, object]) -> str | None:
    location = cast(tuple[object, ...], error.get("loc", ()))
    return next((item for item in location if item in _FIELD_ERRORS), None)


def _is_user_message_error(error: Mapping[object, object]) -> bool:
    location = cast(tuple[object, ...], error.get("loc", ()))
    return len(location) > 2 and "messages" in location


def _field_error(field: str | None) -> str:
    if field is None:
        return "request body must be an object"
    return _FIELD_ERRORS[field]


def chat_validation_detail(
    raw_body: bytes, exc: RequestValidationError, locale: Locale
) -> str:
    error = _first_error(exc)
    if _is_user_message_error(error):
        return build_input_error_message("non_text_message", locale)
    if not raw_body or _error_kind(error) == "json_invalid":
        return "invalid JSON body"
    return _field_error(_error_field(error))


def force_json_content_type(request: Request) -> None:
    headers = request.scope["headers"]
    request.scope["headers"] = [
        header for header in headers if header[0].lower() != _JSON_CONTENT_TYPE[0]
    ] + [_JSON_CONTENT_TYPE]


async def validation_mapped_response(
    handler: RouteHandler, request: Request
) -> Response:
    raw_body = await request.body()
    try:
        return await handler(request)
    except RequestValidationError as exc:
        detail = chat_validation_detail(raw_body, exc, request_locale(request))
        raise HTTPException(status_code=422, detail=detail) from exc


async def _route_response(
    handler: RouteHandler, preflight: Preflight, request: Request
) -> Response:
    force_json_content_type(request)
    rejection = await preflight(request)
    if rejection is not None:
        return rejection
    return await validation_mapped_response(handler, request)


def _route_handler(handler: RouteHandler, preflight: Preflight) -> RouteHandler:
    async def mapped(request: Request) -> Response:
        return await _route_response(handler, preflight, request)

    return mapped


class ChatBodyRoute(APIRoute):
    @abstractmethod
    async def preflight(self, request: Request) -> Response | None:
        raise NotImplementedError

    def get_route_handler(self) -> RouteHandler:
        return _route_handler(super().get_route_handler(), self.preflight)
