"""Actionable classification and reporting of errored L0 smoke cases.

The L0 smoke gate used to report a bare count ("4/80 cases errored"), which
named neither the cases nor the exceptions. This module turns each errored case
into a named, classified, secret-redacted line so a reviewer can tell at a
glance whether the agent broke or the model provider hiccuped (issue #434).
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

ErrorClass = Literal["transport", "agent"]

MESSAGE_LIMIT = 200
# A run where more than this share of cases hit provider transport failures is
# untrustworthy as evidence about the code — it should be re-run, not judged.
TRANSPORT_RATE_CEILING = 0.20

# Exception type names raised by httpx / the OpenAI-compatible client stack when
# the provider connection fails, plus the retryable HTTP statuses.
_TRANSPORT_TYPES = frozenset(
    {
        "APIConnectionError",
        "APITimeoutError",
        "ConnectError",
        "ConnectTimeout",
        "InternalServerError",
        "ModelHTTPError",
        "PoolTimeout",
        "RateLimitError",
        "ReadError",
        "ReadTimeout",
        "RemoteProtocolError",
        "ServiceUnavailableError",
        "WriteError",
        "WriteTimeout",
    }
)
_TRANSPORT_STATUS = re.compile(r"\b(408|409|425|429|500|502|503|504)\b")
_SECRET = re.compile(
    r"\b(?:sk|tp|xai|key)-[A-Za-z0-9_-]{6,}"
    r"|(?:bearer\s+|api[_-]?key\s*[:=]\s*|token\s*[:=]\s*)\S+",
    re.IGNORECASE,
)
_REDACTED = "[REDACTED]"


@dataclass(frozen=True)
class SmokeError:
    """One errored eval case, classified and safe to print."""

    case_id: str
    error_type: str
    message: str
    error_class: ErrorClass

    def format(self) -> str:
        return (
            f"  - {self.case_id} [{self.error_class}] {self.error_type}: {self.message}"
        )


@dataclass(frozen=True)
class SmokeErrorSummary:
    """The errored cases of one run, split by cause."""

    transport: tuple[SmokeError, ...]
    agent: tuple[SmokeError, ...]
    total_cases: int

    @property
    def transport_rate(self) -> float:
        return len(self.transport) / self.total_cases if self.total_cases else 0.0


def classify_error(case_id: str, error_message: str | None) -> SmokeError:
    """Split a ``"TypeName: detail"`` message into a classified, redacted record."""
    error_type, detail = _split_message(error_message or "UnknownError")
    return SmokeError(
        case_id=case_id,
        error_type=error_type,
        message=_truncate(redact_secrets(detail)),
        error_class=_error_class(error_type, detail),
    )


def summarize_errors(
    errors: Sequence[SmokeError], total_cases: int
) -> SmokeErrorSummary:
    """Group classified errors into the transport / agent split."""
    return SmokeErrorSummary(
        transport=tuple(item for item in errors if item.error_class == "transport"),
        agent=tuple(item for item in errors if item.error_class == "agent"),
        total_cases=total_cases,
    )


def smoke_error_failures(summary: SmokeErrorSummary) -> list[str]:
    """Return gate-blocking messages; transport noise reports without blocking."""
    failures = _agent_failure(summary) + _transport_ceiling_failure(summary)
    return [failure for failure in failures if failure]


def format_transport_notice(summary: SmokeErrorSummary) -> str:
    """Render the non-blocking transport report, or an empty string if clean."""
    if not summary.transport or summary.transport_rate > TRANSPORT_RATE_CEILING:
        return ""
    return _block(
        f"{len(summary.transport)}/{summary.total_cases} cases hit provider "
        f"transport errors ({summary.transport_rate:.0%}, not gating — see #434):",
        summary.transport,
    )


def redact_secrets(text: str) -> str:
    """Replace anything shaped like an API key or bearer token."""
    return _SECRET.sub(_REDACTED, text)


def _agent_failure(summary: SmokeErrorSummary) -> list[str]:
    if not summary.agent:
        return []
    header = (
        f"{len(summary.agent)}/{summary.total_cases} cases errored inside the agent "
        "(EVAL_SMOKE requires zero agent errors):"
    )
    return [_block(header, summary.agent)]


def _transport_ceiling_failure(summary: SmokeErrorSummary) -> list[str]:
    if summary.transport_rate <= TRANSPORT_RATE_CEILING:
        return []
    header = (
        f"{len(summary.transport)}/{summary.total_cases} cases hit provider transport "
        f"errors ({summary.transport_rate:.0%} > "
        f"{TRANSPORT_RATE_CEILING:.0%}) — the run is untrustworthy; re-run it:"
    )
    return [_block(header, summary.transport)]


def _block(header: str, errors: Sequence[SmokeError]) -> str:
    return "\n".join([header, *(error.format() for error in errors)])


def _split_message(error_message: str) -> tuple[str, str]:
    head, separator, tail = error_message.partition(": ")
    if separator and _looks_like_type_name(head):
        return head, tail.strip()
    return "UnknownError", error_message.strip()


def _looks_like_type_name(head: str) -> bool:
    return head.isidentifier() and head[:1].isupper()


def _error_class(error_type: str, detail: str) -> ErrorClass:
    if error_type in _TRANSPORT_TYPES:
        return "transport"
    if error_type == "UnexpectedModelBehavior" and _TRANSPORT_STATUS.search(detail):
        return "transport"
    return "agent"


def _truncate(message: str) -> str:
    collapsed = " ".join(message.split())
    if len(collapsed) <= MESSAGE_LIMIT:
        return collapsed
    return collapsed[:MESSAGE_LIMIT] + "…"
