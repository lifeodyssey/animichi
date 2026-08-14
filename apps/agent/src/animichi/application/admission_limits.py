"""Neutral anonymous budget/quota verdicts (TURN-2 #949).

The anonymous daily-budget breaker (X4, issue #274) and the per-identity daily
message quota (issue #282, S1.10) are application-layer admission gates, so
they live here — the application layer never imports ``interfaces``. The
``interfaces`` modules re-export them to keep every existing consumer's single
import site. Both verdicts fail *open* on a read/write error: an unavailable
meter or counter must not take the anonymous surface down.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

import structlog

from animichi.domain.ports import AnonQuotaCounter, UsageMeter

logger = structlog.get_logger(__name__)

#: Best-effort like the budget breaker's own metering hook — an explicit tuple
#: cannot express SQLAlchemy's statement/dialect error derivation straight from
#: Exception, so the most likely real failures are caught here instead of
#: escaping as a user-facing turn failure.
_METER_ERRORS = Exception

#: The container's re-validation of the edge-forwarded X-User-Id (mirrors
#: `_ANON_ID_PATTERN` in `interfaces/routes/_deps.py`): anything not matching
#: this shape is treated as not-an-identity, so quota correctness never
#: depends on the edge being bug-free.
_ANON_ID_PATTERN = re.compile(r"^anon_[0-9a-f]{32}$")


def anon_quota_eligible(anon_id: str) -> bool:
    """Whether *anon_id* is keyed by the anonymous daily counter.

    Shared by the admission read and the exactly-once settlement increment so
    the two never diverge on identity shape.
    """
    return _ANON_ID_PATTERN.fullmatch(anon_id) is not None


@dataclass(frozen=True)
class BudgetVerdict:
    """The container ingress's authoritative anonymous-budget decision."""

    is_exhausted: bool
    spent_usd: float
    budget_usd: float


@dataclass(frozen=True)
class QuotaVerdict:
    """The container ingress's authoritative per-identity quota decision."""

    is_exhausted: bool
    count: int
    quota: int | None
    resets_at: datetime


def utc_today(now: datetime | None = None) -> date:
    """The UTC calendar day the budget and the meter are keyed on."""
    return (now or datetime.now(UTC)).astimezone(UTC).date()


def next_utc_midnight(day: date) -> datetime:
    """The next UTC day boundary after *day* (the same clock as ``daily_usage``)."""
    return datetime.combine(day, time.min, tzinfo=UTC) + timedelta(days=1)


async def anonymous_budget_verdict(
    usage_repo: UsageMeter | None,
    *,
    budget_usd: float,
    today: date | None = None,
) -> BudgetVerdict:
    """Read today's anonymous spend and compare it with the configured ceiling.

    A non-positive budget disables the breaker. A read failure fails OPEN: an
    unavailable meter must not take the anonymous surface down.
    """
    if budget_usd <= 0 or usage_repo is None:
        return BudgetVerdict(is_exhausted=False, spent_usd=0.0, budget_usd=budget_usd)
    try:
        spent = await usage_repo.total_cost_usd(
            usage_date=today or utc_today(), scope="anon"
        )
    except _METER_ERRORS:
        logger.warning("daily_usage_read_failed", exc_info=True)
        return BudgetVerdict(is_exhausted=False, spent_usd=0.0, budget_usd=budget_usd)
    return BudgetVerdict(
        is_exhausted=spent >= budget_usd, spent_usd=spent, budget_usd=budget_usd
    )


async def anonymous_quota_verdict(
    anon_quota_repo: AnonQuotaCounter | None,
    *,
    anon_id: str,
    quota: int | None,
    today: date | None = None,
) -> QuotaVerdict:
    """Read today's message count for *anon_id* and compare it to *quota*.

    ``None`` **or** ``0`` disables the check entirely (the same "0 disables"
    convention as the budget breaker). This is a read, never an increment:
    the count is settled exactly once, at terminal, by :class:`TurnOutcome`
    (TURN-3 #951) — so a visitor who keeps retrying past their own ceiling
    stays rejected, while a never-dispatched turn costs nothing. A read
    failure fails OPEN.
    """
    resolved_today = today or utc_today()
    resets_at = next_utc_midnight(resolved_today)
    if not quota or anon_quota_repo is None or not anon_quota_eligible(anon_id):
        return QuotaVerdict(
            is_exhausted=False, count=0, quota=quota, resets_at=resets_at
        )
    try:
        count = await anon_quota_repo.count_for(
            usage_date=resolved_today, anon_id=anon_id
        )
    except _METER_ERRORS:
        logger.warning("anon_daily_message_count_read_failed", exc_info=True)
        return QuotaVerdict(
            is_exhausted=False, count=0, quota=quota, resets_at=resets_at
        )
    return QuotaVerdict(
        is_exhausted=count >= quota, count=count, quota=quota, resets_at=resets_at
    )
