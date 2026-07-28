"""Typed error taxonomy for the SSRF egress guard (#284 Task 1).

Split out from `egress_guard.py` to keep that module under the 300-line file
cap; imported by both `egress_guard.py` (raises) and `egress_transport.py`
(raises on redirect refusal).
"""

from __future__ import annotations

import enum
from typing import Final


class EgressBlockReason(enum.Enum):
    """Machine-readable rejection category.

    Task 3 maps these to a public error taxonomy — match on `.reason`, never
    on `str(exc)`, which carries only a fixed, non-identifying message.
    """

    EMPTY_URL = "empty_url"
    INVALID_URL = "invalid_url"
    INVALID_SCHEME = "invalid_scheme"
    INVALID_USERINFO = "invalid_userinfo"
    INVALID_HOST = "invalid_host"
    INVALID_HOSTNAME_ENCODING = "invalid_hostname_encoding"
    INVALID_PORT = "invalid_port"
    OWN_INFRASTRUCTURE = "own_infrastructure"
    RESOLUTION_TIMEOUT = "resolution_timeout"
    RESOLUTION_FAILED = "resolution_failed"
    NO_ADDRESSES = "no_addresses"
    ADDRESS_NOT_ROUTABLE = "address_not_routable"
    REDIRECT_REFUSED = "redirect_refused"


_REASON_MESSAGES: Final[dict[EgressBlockReason, str]] = {
    EgressBlockReason.EMPTY_URL: "egress URL is empty",
    EgressBlockReason.INVALID_URL: "egress URL could not be parsed",
    EgressBlockReason.INVALID_SCHEME: "egress URL scheme is not allowed",
    EgressBlockReason.INVALID_USERINFO: "userinfo is not allowed in the egress URL",
    EgressBlockReason.INVALID_HOST: "egress URL is missing a host",
    EgressBlockReason.INVALID_HOSTNAME_ENCODING: "egress URL host is not a valid hostname",
    EgressBlockReason.INVALID_PORT: "egress URL port is not on the allowlist",
    EgressBlockReason.OWN_INFRASTRUCTURE: "egress host is own infrastructure",
    EgressBlockReason.RESOLUTION_TIMEOUT: "DNS resolution timed out",
    EgressBlockReason.RESOLUTION_FAILED: "DNS resolution failed",
    EgressBlockReason.NO_ADDRESSES: "no addresses resolved for host",
    EgressBlockReason.ADDRESS_NOT_ROUTABLE: "resolved address is not publicly routable",
    EgressBlockReason.REDIRECT_REFUSED: "redirect response refused",
}


class EgressBlocked(Exception):
    """Raised whenever a candidate egress destination fails SSRF validation.

    `str(exc)` is always one of the fixed `_REASON_MESSAGES` — it never
    embeds the submitted URL, hostname, resolved IP, or the underlying
    `OSError` text, none of which should reach a caller or an unguarded log
    line (an internal-network DNS oracle is still an oracle). Anything
    diagnostic is on `.detail`, for structured logging only, subject to the
    same redaction path as everything else (Task 2).
    """

    def __init__(self, reason: EgressBlockReason, *, detail: str | None = None) -> None:
        self.reason = reason
        self.detail = detail
        super().__init__(_REASON_MESSAGES[reason])
