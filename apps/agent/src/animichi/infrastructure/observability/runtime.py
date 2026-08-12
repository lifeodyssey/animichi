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
_history_requests = logfire.metric_counter(
    "history_requests_total",
    description="Session-history reads recorded with outcome and message count.",
)
_history_duration = logfire.metric_histogram(
    "history_request_duration_ms",
    unit="ms",
    description="Session-history read duration in milliseconds.",
)
_adoption_requests = logfire.metric_counter(
    "adoption_requests_total",
    description="Session adoptions recorded with count, no-op class, and revision outcome.",
)
_adoption_duration = logfire.metric_histogram(
    "adoption_request_duration_ms",
    unit="ms",
    description="Session adoption duration in milliseconds.",
)
_feedback_requests = logfire.metric_counter(
    "feedback_requests_total",
    description="Feedback submissions recorded with rating class, ownership, and outcome.",
)
_feedback_duration = logfire.metric_histogram(
    "feedback_request_duration_ms",
    unit="ms",
    description="Feedback submission duration in milliseconds.",
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


def record_history_request(
    *,
    duration_ms: float,
    outcome: str,
    message_count: int,
    revision: int,
) -> None:
    """Record one session-history read (SESSION-1 #959 telemetry).

    Outcome, message count, and revision only — never an actor identifier or
    any message content.
    """
    attributes: dict[str, str | int] = {
        "outcome": outcome,
        "message_count": message_count,
        "revision": revision,
    }
    _history_requests.add(1, attributes)
    _history_duration.record(duration_ms, attributes)


def record_adoption_request(
    *,
    duration_ms: float,
    adopted_count: int,
    noop_class: str,
    revisions_bumped: int,
) -> None:
    """Record one session adoption (SESSION-2 #960 telemetry).

    Adoption count, no-op class, and revision outcome only — never an actor or
    Session identifier.
    """
    attributes: dict[str, str | int] = {
        "adopted_count": adopted_count,
        "noop_class": noop_class,
        "revisions_bumped": revisions_bumped,
    }
    _adoption_requests.add(1, attributes)
    _adoption_duration.record(duration_ms, attributes)


def record_feedback_request(
    *,
    duration_ms: float,
    rating_class: str,
    ownership: str,
    outcome: str,
) -> None:
    """Record one feedback submission (AGENT-3 #962 telemetry).

    Rating class, ownership class, and outcome only — never the feedback
    text, an actor identifier, or a Session identifier.
    """
    attributes: dict[str, str | int] = {
        "rating_class": rating_class,
        "ownership": ownership,
        "outcome": outcome,
    }
    _feedback_requests.add(1, attributes)
    _feedback_duration.record(duration_ms, attributes)
