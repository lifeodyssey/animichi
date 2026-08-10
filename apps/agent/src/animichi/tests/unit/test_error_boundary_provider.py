"""Unit tests for provider-error classification (error_boundary).

``is_provider_error`` and ``is_byok_credential_rejection`` must classify by
exception type and status code — never by string scanning — so transient
provider failures surface as clean 503s while a caller's own rejected
credential gets its specific BYOK payload.
"""

from __future__ import annotations

import httpx
import pytest
from pydantic_ai.exceptions import FallbackExceptionGroup, ModelHTTPError

from animichi.agents.error_boundary import (
    is_byok_credential_rejection,
    is_provider_error,
)


def _http_error(status_code: int) -> ModelHTTPError:
    return ModelHTTPError(status_code, "test-model")


def _status_error(status_code: int) -> httpx.HTTPStatusError:
    return httpx.HTTPStatusError(
        f"status {status_code}",
        request=httpx.Request("GET", "https://catalog.test/points"),
        response=httpx.Response(status_code),
    )


@pytest.mark.parametrize("status", [429, 502, 503])
def test_model_http_error_transient_statuses_are_provider_errors(status: int) -> None:
    assert is_provider_error(_http_error(status)) is True


def test_model_http_error_other_status_is_not_provider_error() -> None:
    assert is_provider_error(_http_error(500)) is False


def test_fallback_group_is_always_provider_error() -> None:
    group = FallbackExceptionGroup("all models failed", [RuntimeError("boom")])
    assert is_provider_error(group) is True


def test_httpx_transport_error_is_provider_error() -> None:
    assert is_provider_error(httpx.TransportError("connection refused")) is True


@pytest.mark.parametrize("status", [429, 502, 503])
def test_httpx_status_error_transient_statuses_are_provider_errors(status: int) -> None:
    assert is_provider_error(_status_error(status)) is True


def test_httpx_status_error_other_status_is_not_provider_error() -> None:
    assert is_provider_error(_status_error(400)) is False


def test_plain_exception_is_not_provider_error() -> None:
    assert is_provider_error(ValueError("boom")) is False


@pytest.mark.parametrize("status", [401, 403])
def test_byok_credential_rejection_marks_auth_statuses(status: int) -> None:
    assert is_byok_credential_rejection(_http_error(status)) is True


def test_byok_credential_rejection_ignores_other_statuses() -> None:
    assert is_byok_credential_rejection(_http_error(429)) is False
    assert is_byok_credential_rejection(_http_error(500)) is False


def test_byok_credential_rejection_ignores_non_http_exceptions() -> None:
    assert is_byok_credential_rejection(ValueError("boom")) is False
