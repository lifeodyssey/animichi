"""Model-usage metering and the anonymous daily-budget breaker (S1.8, SD-18).

Every runtime turn already produces a ``RunUsage``; this module is the hook
that turns it into a durable, scope-partitioned row in ``daily_usage``, and the
container-ingress read that decides whether the anonymous daily budget (X4) is
exhausted. The container is deliberately the only tier that reads the table —
the edge keeps a same-day latch of this verdict but never queries the database.

Scope boundary: this is a *global dollar budget*. The per-identity daily
message quota is issue #282 and reads the same table without changing this one.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Literal

import structlog
from pydantic_ai.usage import RunUsage

from agent.domain.ports import get_usage_repo

logger = structlog.get_logger(__name__)

UsageScope = Literal["anon", "user", "byok"]

#: Prefix the edge stamps on every anonymous ``X-User-Id`` (worker/auth.ts).
ANON_USER_ID_PREFIX = "anon_"
ANONYMOUS_USER_TYPE = "anonymous"
ANON_BUDGET_EXHAUSTED_CODE = "anon_budget_exhausted"

_TOKENS_PER_MILLION = 1_000_000
_METER_ERRORS = (OSError, RuntimeError, ValueError, TypeError)


@dataclass(frozen=True)
class UsagePrices:
    """Per-million-token prices; configuration, never literals in the logic."""

    input_usd_per_mtok: float
    output_usd_per_mtok: float


@dataclass(frozen=True)
class BudgetVerdict:
    """The container ingress's authoritative anonymous-budget decision."""

    exhausted: bool
    spent_usd: float
    budget_usd: float


def utc_today(now: datetime | None = None) -> date:
    """The UTC calendar day the budget and the meter are keyed on."""
    return (now or datetime.now(UTC)).astimezone(UTC).date()


def scope_for_identity(user_id: str | None, user_type: str | None) -> UsageScope:
    """Classify a turn's spend by who paid for it."""
    if user_type == ANONYMOUS_USER_TYPE:
        return "anon"
    if user_id is not None and user_id.startswith(ANON_USER_ID_PREFIX):
        return "anon"
    return "user"


def usage_cost_usd(usage: RunUsage, prices: UsagePrices) -> float:
    """Price one turn's token usage. Unpriced models meter tokens at zero cost."""
    input_usd = usage.input_tokens * prices.input_usd_per_mtok
    output_usd = usage.output_tokens * prices.output_usd_per_mtok
    return (input_usd + output_usd) / _TOKENS_PER_MILLION


async def record_turn_usage(
    db: object,
    *,
    usage: RunUsage | None,
    scope: UsageScope,
    prices: UsagePrices,
    today: date | None = None,
) -> None:
    """Accumulate one turn into ``daily_usage``; best-effort, never fatal."""
    repo = get_usage_repo(db)
    if repo is None or usage is None:
        return
    try:
        await repo.accumulate_usage(
            usage_date=today or utc_today(),
            scope=scope,
            requests=usage.requests,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cost_usd=usage_cost_usd(usage, prices),
        )
    except _METER_ERRORS:
        logger.warning("daily_usage_record_failed", scope=scope)


async def anonymous_budget_verdict(
    db: object,
    *,
    budget_usd: float,
    today: date | None = None,
) -> BudgetVerdict:
    """Read today's anonymous spend and compare it with the configured ceiling.

    A non-positive budget disables the breaker. A read failure fails OPEN: an
    unavailable meter must not take the anonymous surface down, and the edge
    latch only ever caches an explicit ``exhausted`` verdict.
    """
    repo = get_usage_repo(db)
    if budget_usd <= 0 or repo is None:
        return BudgetVerdict(exhausted=False, spent_usd=0.0, budget_usd=budget_usd)
    try:
        spent = await repo.total_cost_usd(usage_date=today or utc_today(), scope="anon")
    except _METER_ERRORS:
        logger.warning("daily_usage_read_failed")
        return BudgetVerdict(exhausted=False, spent_usd=0.0, budget_usd=budget_usd)
    return BudgetVerdict(
        exhausted=spent >= budget_usd, spent_usd=spent, budget_usd=budget_usd
    )
