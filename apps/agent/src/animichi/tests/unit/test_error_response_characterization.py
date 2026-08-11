"""Golden coverage for the public error response boundary."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai.exceptions import ModelHTTPError

from animichi.agents.base import ModelAliasError
from animichi.agents.selection import SelectionError
from animichi.application.errors import ApplicationError, ErrorCode
from animichi.interfaces.public_api import (
    PublicAPIRequest,
    PublicAPIResponse,
    RuntimeAPI,
)
from animichi.interfaces.routes._deps import _http_error_code, _http_status_for_response

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


class _SessionRepo:
    async def check_session_owner(self, session_id: str, user_id: str) -> bool:
        del session_id, user_id
        return True

    async def upsert_session(
        self,
        session_id: str,
        session_state: dict[str, object],
        metadata: dict[str, object],
    ) -> None:
        del session_id, session_state, metadata
        return None

    async def upsert_conversation(
        self, session_id: str, user_id: str, first_query: str
    ) -> None:
        del session_id, user_id, first_query
        return None

    async def update_conversation_title(self, session_id: str, title: str) -> None:
        del session_id, title
        return None


class _Db:
    session = _SessionRepo()


async def _map_exception(exc: Exception, *, is_byok: bool = False) -> PublicAPIResponse:
    from animichi.infrastructure.session.memory import InMemorySessionStore

    api = RuntimeAPI(
        _Db(),
        session_store=InMemorySessionStore(),
        model_http_client=MagicMock(),
    )
    with patch(
        "animichi.interfaces.public_api.run_animichi_agent",
        new=AsyncMock(side_effect=exc),
    ):
        return await api.handle(
            PublicAPIRequest(
                text="hello",
                session_id=None if not is_byok else "s-1",
            ),
            is_byok=is_byok,
            user_id=None if not is_byok else "user-1",
            user_type=None if not is_byok else "human",
        )


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
