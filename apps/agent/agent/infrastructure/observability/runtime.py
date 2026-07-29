"""Thin logfire-backed tracing and metrics wrapper.

This module is the single observability entry point for the runtime.
Spans and metrics are created through logfire's native API; export is
governed entirely by ``logfire.configure()`` (see ``setup_logfire``),
which sends to Logfire only when ``LOGFIRE_TOKEN`` is present.
"""

from __future__ import annotations

import logfire
from pydantic_ai.exceptions import UsageLimitExceeded

_runtime_requests = logfire.metric_counter(
    "runtime_requests_total",
    description="Total number of runtime API calls.",
)
_runtime_duration = logfire.metric_histogram(
    "runtime_request_duration_ms",
    unit="ms",
    description="End-to-end runtime API duration in milliseconds.",
)
_http_requests = logfire.metric_counter(
    "http_requests_total",
    description="Total number of HTTP requests handled by the service.",
)
_http_duration = logfire.metric_histogram(
    "http_request_duration_ms",
    unit="ms",
    description="HTTP request duration in milliseconds.",
)


def runtime_span(name: str) -> logfire.LogfireSpan:
    """Open a span for a runtime-level operation."""
    return logfire.span(name)


def http_span(name: str) -> logfire.LogfireSpan:
    """Open a span for HTTP request handling."""
    return logfire.span(name)


def record_runtime_request(
    *,
    duration_ms: float,
    intent: str,
    status: str,
    transport: str,
) -> None:
    """Record runtime-level request metrics."""
    attributes = {"intent": intent, "status": status, "transport": transport}
    _runtime_requests.add(1, attributes)
    _runtime_duration.record(duration_ms, attributes)


def record_http_request(
    *,
    duration_ms: float,
    method: str,
    route: str,
    status_code: int,
) -> None:
    """Record HTTP-level request metrics."""
    attributes: dict[str, str | int] = {
        "http.method": method,
        "http.route": route,
        "http.status_code": status_code,
    }
    _http_requests.add(1, attributes)
    _http_duration.record(duration_ms, attributes)


def record_agent_run_error(error: BaseException) -> None:
    """Record a failed PydanticAI run without changing propagation semantics."""
    if isinstance(error, UsageLimitExceeded):
        return
    logfire.error(
        "animichi_agent_run_error",
        error_type=type(error).__name__,
        error_message=str(error)[:500],
        _exc_info=error,
    )


def record_managed_prompt_resolution(
    *, source: str, version: str, label: str, failure: str | None = None
) -> None:
    """Record the prompt authority selected for an Animichi agent run."""
    if failure is None:
        logfire.info(
            "animichi_managed_prompt_resolved",
            managed_prompt_source=source,
            managed_prompt_version=version,
            managed_prompt_label=label,
        )
        return
    logfire.warning(
        "animichi_managed_prompt_fallback",
        managed_prompt_source=source,
        managed_prompt_version=version,
        managed_prompt_label=label,
        failure=failure,
    )
