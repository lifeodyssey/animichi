"""Per-identity anonymous daily message quota (issue #282, S1.10).

Distinct from the global dollar breaker in ``usage_metering.py`` (X4, #274):
that one asks "has the *whole* anonymous surface spent its budget for today?";
this one asks "has *this one* anon identity spent its own message allowance
for today?". Both read/write durable Postgres state so the check survives
across container instances (#446 ruled out an in-process counter for exactly
this reason) and both fail *open* on a read/write error — an unavailable
counter must not take the anonymous surface down.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

import structlog

from agent.domain.ports import get_anon_quota_repo
from agent.interfaces.usage_metering import utc_today

logger = structlog.get_logger(__name__)

ANON_QUOTA_EXHAUSTED_CODE = "anon_quota_exhausted"

#: The container's own re-validation of the edge-forwarded X-User-Id (mirrors
#: `_ANON_ID_PATTERN` in `interfaces/routes/_deps.py`, issue #460 precedent):
#: anything not matching this shape is treated as not-an-identity, so quota
#: correctness never depends on the edge being bug-free. A caller that fails
#: this check is neither counted nor rejected — the budget breaker above
#: already gates malformed-identity anonymous traffic; this quota simply
#: declines to key a counter row on an untrusted string.
_ANON_ID_PATTERN = re.compile(r"^anon_[0-9a-f]{32}$")

#: The 403 payload field carrying the next UTC reset instant (review
#: follow-up on #282) — named once so ``chat.py`` and the contract pin test
#: never drift on the key independently of the wire code above.
QUOTA_RESETS_AT_FIELD = "quota_resets_at"

#: Best-effort like the budget breaker's own metering hook — see
#: ``usage_metering._METER_ERRORS`` for why this can't be narrower.
_QUOTA_ERRORS = Exception


@dataclass(frozen=True)
class QuotaVerdict:
    """The container ingress's authoritative per-identity quota decision."""

    exhausted: bool
    count: int
    quota: int | None
    resets_at: datetime


def next_utc_midnight(day: date) -> datetime:
    """The next UTC day boundary after *day* (the same clock as ``daily_usage``).

    The frontend renders this as ``quota_resets_at`` so the visitor sees an
    accurate local-time reset instant instead of a mismatched "resets at JST
    09:00 but the copy says today" (issue #282 review follow-up).
    """
    return datetime.combine(day, time.min, tzinfo=UTC) + timedelta(days=1)


async def anonymous_quota_verdict(
    db: object,
    *,
    anon_id: str,
    quota: int | None,
    today: date | None = None,
) -> QuotaVerdict:
    """Increment today's message count for *anon_id* and compare it to *quota*.

    ``None`` **or** ``0`` disables the check entirely — the same "0 disables"
    convention as the budget breaker's ``ANON_DAILY_COST_BUDGET_USD`` (review
    follow-up: a bare ``quota=0`` previously meant "reject every anonymous
    message", silently inverting the budget knob's convention and inviting an
    ops footgun the first time someone reused that "0 disables" mental model
    here). The counter increments on every attempt (including ones this call
    goes on to reject), so a visitor who keeps retrying past their own
    ceiling stays rejected rather than flapping. A read/write failure fails
    OPEN: an unavailable counter must not take the anonymous surface down.
    """
    resolved_today = today or utc_today()
    resets_at = next_utc_midnight(resolved_today)
    repo = get_anon_quota_repo(db)
    if not quota or repo is None or not _ANON_ID_PATTERN.fullmatch(anon_id):
        return QuotaVerdict(exhausted=False, count=0, quota=quota, resets_at=resets_at)
    try:
        count = await repo.increment_and_count(
            usage_date=resolved_today, anon_id=anon_id
        )
    except _QUOTA_ERRORS:
        logger.warning("anon_daily_message_count_failed", exc_info=True)
        return QuotaVerdict(exhausted=False, count=0, quota=quota, resets_at=resets_at)
    return QuotaVerdict(
        exhausted=count > quota, count=count, quota=quota, resets_at=resets_at
    )
