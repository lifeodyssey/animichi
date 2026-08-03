"""Structural and SD-19 guarantees for the public error registry."""

from agent.agents.error_messages import (
    build_timeout_error_message,
    public_error_message,
)
from agent.application.errors import ErrorCode
from agent.interfaces.error_registry import (
    ERROR_RESPONSE_REGISTRY,
    public_error_response,
    timeout_error_response,
)

BOUNDARY_CODES = {
    "invalid_request",
    "invalid_model_alias",
    "invalid_selection",
    "forbidden",
    "byok_credential_rejected",
    "byok_requires_login",
    "provider_error",
    "http_error",
}


def test_registry_contains_every_supported_error_code() -> None:
    registered = {str(code) for code in ERROR_RESPONSE_REGISTRY}
    application_codes = {code.value for code in ErrorCode}
    assert registered == application_codes | BOUNDARY_CODES


def test_registry_messages_come_from_the_sd19_message_source() -> None:
    for code, spec in ERROR_RESPONSE_REGISTRY.items():
        assert spec.safe_message == public_error_message(str(code))


def test_provider_response_uses_safe_copy_for_both_public_messages() -> None:
    response = public_error_response("provider_error", intent="error")
    assert response.errors[0].message == response.message


def test_timeout_detail_uses_the_safe_formatter() -> None:
    response = timeout_error_response(12)
    assert response.errors[0].message == build_timeout_error_message(12)
