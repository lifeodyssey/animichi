"""Exception handlers and observability middleware for the FastAPI app."""

from __future__ import annotations

import json
from time import perf_counter

import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response

from agent.infrastructure.observability import (
    http_span,
    record_http_request,
)
from agent.interfaces.routes._deps import (
    _contains_json_invalid_error,
    _error_response,
    _http_error_code,
)

logger = structlog.get_logger(__name__)

SENSITIVE_HEADERS = frozenset(
    {"x-byok-key", "x-byok-base-url", "authorization", "cf-turnstile-response"}
)
_SENSITIVE_HEADER_NAMES = frozenset(name.encode() for name in SENSITIVE_HEADERS)
_REDACTED_VALUE = b"[redacted]"
_RAW_HEADERS_STATE_KEY = "byok_raw_sensitive_headers"


def register_exception_handlers(app: FastAPI) -> None:
    """Attach structured JSON exception handlers to *app*."""

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        del request
        errors_obj: object = exc.errors()
        if _contains_json_invalid_error(errors_obj):
            return _error_response(
                "invalid_json",
                "Request body must be valid JSON.",
                status_code=400,
            )
        return _error_response(
            "invalid_request",
            "Request payload did not match the public API schema.",
            status_code=422,
            details=errors_obj,
        )

    @app.exception_handler(ValidationError)
    async def handle_validation_error(
        request: Request,
        exc: ValidationError,
    ) -> JSONResponse:
        del request
        details_obj: object = json.loads(exc.json())
        return _error_response(
            "invalid_request",
            "Request payload did not match the public API schema.",
            status_code=422,
            details=details_obj,
        )

    @app.exception_handler(HTTPException)
    async def handle_http_exception(
        request: Request,
        exc: HTTPException,
    ) -> JSONResponse:
        del request
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return _error_response(
            _http_error_code(exc.status_code),
            detail,
            status_code=exc.status_code,
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        logger.exception(
            "fastapi_unhandled_exception",
            path=request.url.path,
            error=str(exc),
        )
        return _error_response(
            "internal_error",
            "Something went wrong. Please try again.",
            status_code=500,
        )


def register_observability_middleware(app: FastAPI) -> None:
    """Attach OpenTelemetry request tracing middleware to *app*."""

    @app.middleware("http")
    async def observability_middleware(
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        started_at = perf_counter()
        status_code = 500

        with http_span("http.request") as span:
            span.set_attribute("http.method", request.method)

            try:
                response = await call_next(request)
            except Exception as exc:
                span.record_exception(exc)
                raise
            else:
                status_code = response.status_code
                return response
            finally:
                elapsed_ms = (perf_counter() - started_at) * 1000
                route_obj: object = request.scope.get("route")
                route_path_obj: object = getattr(route_obj, "path", request.url.path)
                route_path = (
                    route_path_obj
                    if isinstance(route_path_obj, str)
                    else request.url.path
                )
                span.set_attribute("http.route", route_path)
                span.set_attribute("http.status_code", status_code)
                record_http_request(
                    duration_ms=elapsed_ms,
                    method=request.method,
                    route=route_path,
                    status_code=status_code,
                )


def register_credential_stripping_middleware(app: FastAPI) -> None:
    """Attach the BYOK credential-stripping middleware (X3, Task 2).

    Must be registered **last**. Starlette's ``add_middleware`` does
    ``user_middleware.insert(0, ...)``, and ``build_middleware_stack`` wraps
    with ``for ... in reversed(middleware)`` — so the most recently
    registered middleware ends up outermost *among ``app.user_middleware``*.
    Registering this one last makes it wrap ``observability_middleware`` and
    every exception handler, so nothing downstream of it — logs, spans, or
    serialized exceptions — ever observes a raw sensitive header value.
    (rev4 correction: rev2/rev3 said "registered first (outermost)", which is
    backwards and would have voided this red line while every test still
    passed — see the BYOK spec, Task 2/P1-4.)

    Starlette's built-in ``ServerErrorMiddleware`` sits outside all of
    ``user_middleware``, including this one — but it only reads the same
    ``request.scope`` this middleware has already mutated, so AC4 holds
    regardless. A pure-ASGI rewrite that stopped constructing `Request`
    objects on top of `scope` (bypassing FastAPI's exception-handler layer
    entirely) would need to re-verify that assumption directly.
    """

    @app.middleware("http")
    async def strip_credential_headers(
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        raw_values, scrubbed_headers = _split_sensitive_headers(
            request.scope["headers"]
        )
        request.scope["headers"] = scrubbed_headers
        setattr(request.state, _RAW_HEADERS_STATE_KEY, raw_values)
        return await call_next(request)


def _split_sensitive_headers(
    headers: list[tuple[bytes, bytes]],
) -> tuple[dict[bytes, bytes], list[tuple[bytes, bytes]]]:
    """Split raw ASGI headers into a private raw stash and a scrubbed list.

    An empty sensitive-header value (present but blank) is left untouched
    and is not stashed or redacted — there is nothing sensitive to protect,
    and rewriting it would spuriously alter the attribute key set that
    downstream consumers observe (T2-AC3).
    """
    raw_values: dict[bytes, bytes] = {}
    scrubbed_headers: list[tuple[bytes, bytes]] = []
    for name, value in headers:
        if name.lower() in _SENSITIVE_HEADER_NAMES and value:
            raw_values[name.lower()] = value
            scrubbed_headers.append((name, _REDACTED_VALUE))
        else:
            scrubbed_headers.append((name, value))
    return raw_values, scrubbed_headers


def get_raw_sensitive_header(request: Request, name: str) -> bytes | None:
    """Read the original, pre-redaction value of a sensitive header.

    The only sanctioned caller is the BYOK credential dependency (Task 3):
    every other consumer only ever sees ``request.scope["headers"]`` after
    ``strip_credential_headers`` has replaced sensitive values with
    ``[redacted]``.
    """
    stash: dict[bytes, bytes] = getattr(request.state, _RAW_HEADERS_STATE_KEY, {})
    return stash.get(name.lower().encode())
