"""Golden coverage for the public error response boundary."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai.exceptions import ModelHTTPError

from agent.agents.base import ModelAliasError
from agent.agents.selection import SelectionError
from agent.application.errors import ApplicationError, ErrorCode
from agent.interfaces.public_api import PublicAPIRequest, PublicAPIResponse, RuntimeAPI
from agent.interfaces.routes._deps import _http_error_code, _http_status_for_response

APPLICATION_CASES = (
    (
        ErrorCode.INTERNAL_ERROR,
        500,
        "The runtime failed before producing a pipeline result.",
    ),
    (ErrorCode.UNKNOWN_ERROR, 500, "An unknown error occurred. Please try again."),
    (ErrorCode.INVALID_INPUT, 400, "Invalid input."),
    (ErrorCode.MISSING_REQUIRED_FIELD, 400, "A required field is missing."),
    (ErrorCode.INVALID_FORMAT, 400, "The request format is invalid."),
    (ErrorCode.NOT_FOUND, 404, "The requested resource was not found."),
    (ErrorCode.ALREADY_EXISTS, 409, "The resource already exists."),
    (
        ErrorCode.EXTERNAL_SERVICE_ERROR,
        500,
        "An external service failed. Please try again.",
    ),
    (ErrorCode.RATE_LIMITED, 429, "Too many requests. Please try again later."),
    (
        ErrorCode.SERVICE_UNAVAILABLE,
        500,
        "The service is temporarily unavailable. Please try again.",
    ),
    (
        ErrorCode.CONFIGURATION_ERROR,
        500,
        "The service is temporarily unavailable. Please try again.",
    ),
    (
        ErrorCode.MISSING_CONFIG,
        500,
        "The service is temporarily unavailable. Please try again.",
    ),
    (ErrorCode.AUTHENTICATION_ERROR, 401, "Authentication failed."),
    (ErrorCode.INVALID_CREDENTIALS, 401, "Invalid credentials."),
)

SPECIAL_CASES = (
    (
        TimeoutError(),
        False,
        ErrorCode.TIMEOUT.value,
        "timeout",
        504,
        "The request took too long. Please try again.",
    ),
    (
        ModelAliasError("unsupported"),
        False,
        "invalid_model_alias",
        "error",
        400,
        "Invalid model alias.",
    ),
    (
        SelectionError("Invalid selection."),
        False,
        "invalid_selection",
        "invalid_request",
        400,
        "Invalid selection.",
    ),
    (
        ModelHTTPError(401, "provider secret"),
        True,
        "byok_credential_rejected",
        "error",
        403,
        "Your BYOK provider rejected the credential. Please check your key and try again.",
    ),
    (
        ModelHTTPError(503, "provider secret"),
        False,
        "provider_error",
        "provider_error",
        500,
        "The AI service is temporarily unavailable. Please try again in a moment.",
    ),
)


async def _map_exception(exc: Exception, *, is_byok: bool = False) -> PublicAPIResponse:
    api = RuntimeAPI(object(), model_http_client=MagicMock())
    dispatch = AsyncMock(side_effect=exc)
    with patch.object(api, "_dispatch_request", new=dispatch):
        _, response, _ = await api._execute_pipeline(
            PublicAPIRequest(text="hello"),
            None,
            [],
            None,
            None,
            object(),
            None,
            is_byok=is_byok,
        )
    return response


@pytest.mark.parametrize(("code", "http_status", "safe_message"), APPLICATION_CASES)
async def test_application_error_response_triples(
    code: ErrorCode, http_status: int, safe_message: str
) -> None:
    exc = ApplicationError(safe_message)
    exc.error_code = code

    response = await _map_exception(exc)

    assert (response.status, _http_status_for_response(response), response.message) == (
        "error",
        http_status,
        safe_message,
    )
    assert response.errors[0].code == code.value


@pytest.mark.parametrize(
    ("exc", "is_byok", "code", "status", "http_status", "safe_message"),
    SPECIAL_CASES,
)
async def test_special_error_response_triples(
    exc: Exception,
    is_byok: bool,
    code: str,
    status: str,
    http_status: int,
    safe_message: str,
) -> None:
    response = await _map_exception(exc, is_byok=is_byok)

    assert (response.status, _http_status_for_response(response), response.message) == (
        status,
        http_status,
        safe_message,
    )
    assert response.errors[0].code == code


def test_golden_cases_cover_every_application_error_code() -> None:
    covered = {code for code, _, _ in APPLICATION_CASES} | {ErrorCode.TIMEOUT}
    assert covered == set(ErrorCode)


@pytest.mark.parametrize(
    ("http_status", "error_code"),
    (
        (400, "invalid_request"),
        (401, "authentication_error"),
        (403, "forbidden"),
        (404, "not_found"),
        (409, "already_exists"),
        (429, "rate_limited"),
        (503, "internal_error"),
        (418, "http_error"),
    ),
)
def test_http_error_code_characterization(http_status: int, error_code: str) -> None:
    assert _http_error_code(http_status) == error_code
