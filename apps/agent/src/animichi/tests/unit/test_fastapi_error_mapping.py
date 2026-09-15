"""The FastAPI adapter's mapping from HTTP/validation failures to error codes.

Every adapter error leaves as one envelope, ``{"error": {"code", "message"}}``,
so the status an upstream raises and the code a client branches on are decided
here — a status with no code, or a JSON-parse failure read as a generic 400,
would reach the frontend as an unhandled shape. The route-level errors
themselves, and the lifespan behaviours around them, are pinned in
``test_fastapi_route_errors.py`` and ``test_fastapi_lifecycle.py``.
"""

from __future__ import annotations

from animichi.interfaces.fastapi_service import (
    _contains_json_invalid_error,
    _http_error_code,
)


def test_http_error_code_maps_404() -> None:
    assert _http_error_code(404) == "not_found"


def test_http_error_code_maps_503_to_internal_error() -> None:
    assert _http_error_code(503) == "internal_error"


def test_contains_json_invalid_error_detects_json_invalid() -> None:
    errors_obj = [{"type": "json_invalid"}]
    assert _contains_json_invalid_error(errors_obj) is True


def test_contains_json_invalid_error_returns_false_for_other_types() -> None:
    errors_obj = [{"type": "missing"}]
    assert _contains_json_invalid_error(errors_obj) is False
