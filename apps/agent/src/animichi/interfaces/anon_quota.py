"""Per-identity anonymous daily message quota (issue #282, S1.10).

Distinct from the global dollar breaker in ``usage_metering.py`` (X4, #274):
that one asks "has the *whole* anonymous surface spent its budget for today?";
this one asks "has *this one* anon identity spent its own message allowance
for today?". Both read/write durable Postgres state so the check survives
across container instances (#446 ruled out an in-process counter for exactly
this reason) and both fail *open* on a read/write error — an unavailable
counter must not take the anonymous surface down.

The verdict logic lives in ``application.admission_limits`` (TURN-2 #949) and
is re-exported here to keep every existing consumer's import site; this module
owns the wire-facing constants.
"""

from __future__ import annotations

from animichi.application.admission_limits import (
    anonymous_quota_verdict,
    next_utc_midnight,
)

ANON_QUOTA_EXHAUSTED_CODE = "anon_quota_exhausted"

#: The 403 payload field carrying the next UTC reset instant (review
#: follow-up on #282) — named once so ``chat.py`` and the contract pin test
#: never drift on the key independently of the wire code above.
QUOTA_RESETS_AT_FIELD = "quota_resets_at"


__all__ = [
    "ANON_QUOTA_EXHAUSTED_CODE",
    "QUOTA_RESETS_AT_FIELD",
    "anonymous_quota_verdict",
    "next_utc_midnight",
]
