"""Observability wrappers backed by logfire.

Usage:
    from agent.infrastructure.observability import (
        record_runtime_request,
        runtime_span,
    )

    with runtime_span("operation") as span:
        span.set_attribute("key", "value")
        # do work
"""

from agent.infrastructure.observability.runtime import (
    http_span,
    record_http_request,
    record_runtime_request,
    runtime_span,
)

__all__ = [
    "http_span",
    "record_http_request",
    "record_runtime_request",
    "runtime_span",
]
