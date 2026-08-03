"""Single source of truth for public error response semantics."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal, TypeAlias

from agent.agents.error_messages import (
    INTERNAL_ERROR_DETAIL_MESSAGE,
    build_timeout_error_message,
    public_error_message,
)
from agent.application.errors import ErrorCode
from agent.interfaces.schemas import JsonObject, PublicAPIError, PublicAPIResponse

BoundaryErrorCode: TypeAlias = Literal[
    "invalid_request",
    "invalid_model_alias",
    "invalid_selection",
    "forbidden",
    "byok_credential_rejected",
    "byok_requires_login",
    "provider_error",
    "http_error",
]
PublicErrorCode: TypeAlias = ErrorCode | BoundaryErrorCode


@dataclass(frozen=True)
class ErrorResponseSpec:
    status: str
    http_status: int
    safe_message: str


def _spec(code: PublicErrorCode, status: str, http_status: int) -> ErrorResponseSpec:
    return ErrorResponseSpec(status, http_status, public_error_message(str(code)))


ERROR_RESPONSE_REGISTRY: dict[PublicErrorCode, ErrorResponseSpec] = {
    "invalid_request": _spec("invalid_request", "invalid_request", 400),
    ErrorCode.INVALID_INPUT: _spec(ErrorCode.INVALID_INPUT, "error", 400),
    "invalid_model_alias": _spec("invalid_model_alias", "error", 400),
    "invalid_selection": _spec("invalid_selection", "invalid_request", 400),
    ErrorCode.MISSING_REQUIRED_FIELD: _spec(
        ErrorCode.MISSING_REQUIRED_FIELD, "error", 400
    ),
    ErrorCode.INVALID_FORMAT: _spec(ErrorCode.INVALID_FORMAT, "error", 400),
    ErrorCode.AUTHENTICATION_ERROR: _spec(ErrorCode.AUTHENTICATION_ERROR, "error", 401),
    ErrorCode.INVALID_CREDENTIALS: _spec(ErrorCode.INVALID_CREDENTIALS, "error", 401),
    "forbidden": _spec("forbidden", "error", 403),
    "byok_credential_rejected": _spec("byok_credential_rejected", "error", 403),
    "byok_requires_login": _spec("byok_requires_login", "error", 403),
    ErrorCode.NOT_FOUND: _spec(ErrorCode.NOT_FOUND, "error", 404),
    ErrorCode.ALREADY_EXISTS: _spec(ErrorCode.ALREADY_EXISTS, "error", 409),
    ErrorCode.RATE_LIMITED: _spec(ErrorCode.RATE_LIMITED, "error", 429),
    ErrorCode.TIMEOUT: _spec(ErrorCode.TIMEOUT, "timeout", 504),
    ErrorCode.INTERNAL_ERROR: _spec(ErrorCode.INTERNAL_ERROR, "error", 500),
    ErrorCode.UNKNOWN_ERROR: _spec(ErrorCode.UNKNOWN_ERROR, "error", 500),
    ErrorCode.EXTERNAL_SERVICE_ERROR: _spec(
        ErrorCode.EXTERNAL_SERVICE_ERROR, "error", 500
    ),
    ErrorCode.SERVICE_UNAVAILABLE: _spec(ErrorCode.SERVICE_UNAVAILABLE, "error", 500),
    ErrorCode.CONFIGURATION_ERROR: _spec(ErrorCode.CONFIGURATION_ERROR, "error", 500),
    ErrorCode.MISSING_CONFIG: _spec(ErrorCode.MISSING_CONFIG, "error", 500),
    "provider_error": _spec("provider_error", "provider_error", 500),
    "http_error": _spec("http_error", "error", 500),
}


def error_response_spec(code: PublicErrorCode) -> ErrorResponseSpec:
    return ERROR_RESPONSE_REGISTRY[code]


def public_error_response(
    code: PublicErrorCode,
    *,
    intent: str = "unknown",
    details: JsonObject | None = None,
    ui: dict[str, str] | None = None,
) -> PublicAPIResponse:
    return _public_error_response(code, intent, details, ui)


def _public_error_response(
    code: PublicErrorCode,
    intent: str,
    details: JsonObject | None,
    ui: dict[str, str] | None,
    error_message: str | None = None,
) -> PublicAPIResponse:
    spec = error_response_spec(code)
    error = PublicAPIError(
        code=str(code),
        message=error_message or spec.safe_message,
        details=details or {},
    )
    return PublicAPIResponse(
        success=False,
        status=spec.status,
        intent=intent,
        message=spec.safe_message,
        errors=[error],
        ui=ui,
    )


def timeout_error_response(deadline_seconds: float) -> PublicAPIResponse:
    message = build_timeout_error_message(deadline_seconds)
    return _public_error_response(ErrorCode.TIMEOUT, "error", None, None, message)


def internal_error_response() -> PublicAPIResponse:
    return _public_error_response(
        ErrorCode.INTERNAL_ERROR,
        "unknown",
        None,
        None,
        INTERNAL_ERROR_DETAIL_MESSAGE,
    )


# Which status wins when one response carries several error codes. Caller-
# fixable problems outrank server faults so the actionable one surfaces, and 504
# outranks the 500 family because a timeout is the more specific diagnosis.
# Declared here rather than inferred from registry iteration order, so
# reordering the registry cannot silently change API status behaviour.
_STATUS_PRECEDENCE: tuple[int, ...] = (400, 401, 403, 404, 409, 429, 504, 500)


def http_status_for_error_codes(codes: Iterable[str]) -> int:
    values = set(codes)
    matched = {
        spec.http_status
        for code, spec in ERROR_RESPONSE_REGISTRY.items()
        if str(code) in values
    }
    if not matched:
        return ERROR_RESPONSE_REGISTRY[ErrorCode.INTERNAL_ERROR].http_status
    return min(matched, key=_STATUS_PRECEDENCE.index)


def error_code_for_http_status(status_code: int) -> str:
    if status_code >= 500:
        return ErrorCode.INTERNAL_ERROR.value
    for code, spec in ERROR_RESPONSE_REGISTRY.items():
        if spec.http_status == status_code:
            return str(code)
    return "http_error"
