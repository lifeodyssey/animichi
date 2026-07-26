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
#: Anchored on the `status_code: N` field pydantic-ai puts in the message, not a
#: bare number: an UnexpectedModelBehavior whose prose happens to contain "429"
#: (a token count, an id) must not be excused as transport.
_TRANSPORT_STATUS = re.compile(r"status_code:\s*(408|409|425|429|5\d{2})\b")
_SECRET = re.compile(
    # Prefixed provider keys, with `_` as well as `-` (sk_live_… is real).
    r"\b(?:sk|tp|xai|key)[-_][A-Za-z0-9_-]{6,}"
    # JWTs — three base64url segments; MiMo/DeepSeek do not use them today,
    # but a BYOK provider (#284) or a gateway may put one in an error body.
    r"|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"
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


#: Carry an HTTP status, so their class depends on WHICH status. pydantic-ai
#: raises ModelHTTPError for any 4xx or 5xx alike, so treating the type as
#: transport would excuse exactly the failures this gate exists to catch: a
#: prompt-size or tool-schema regression surfaces as a provider 400, and a
#: handful of those would sit under the 20% transport ceiling and merge green.
_STATUS_BEARING_TYPES = frozenset({"ModelHTTPError", "UnexpectedModelBehavior"})


def _error_class(error_type: str, detail: str) -> ErrorClass:
    if error_type in _STATUS_BEARING_TYPES:
        return "transport" if _TRANSPORT_STATUS.search(detail) else "agent"
    if error_type in _TRANSPORT_TYPES:
        return "transport"
    return "agent"


def _truncate(message: str) -> str:
    collapsed = " ".join(message.split())
    if len(collapsed) <= MESSAGE_LIMIT:
        return collapsed
    return collapsed[:MESSAGE_LIMIT] + "…"
