"""Observability wrappers backed by logfire.

Usage:
    from animichi.infrastructure.observability import (
        record_runtime_request,
        runtime_span,
    )

    with runtime_span("operation") as span:
        span.set_attribute("key", "value")
        # do work
"""

from animichi.infrastructure.observability.runtime import (
    http_span,
    record_agent_run_error,
    record_http_request,
    record_runtime_request,
    runtime_span,
)

__all__ = [
    "http_span",
    "record_agent_run_error",
    "record_http_request",
    "record_runtime_request",
    "runtime_span",
]
