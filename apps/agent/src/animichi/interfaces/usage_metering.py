"""Model-usage metering and the anonymous daily-budget breaker (S1.8, SD-18).

Every runtime turn already produces a ``ModelTurnUsage``; this module is the hook
that turns it into a durable, scope-partitioned row in ``daily_usage``, and the
container-ingress read that decides whether the anonymous daily budget (X4) is
exhausted. The container is deliberately the only tier that reads the table —
the edge keeps a same-day latch of this verdict but never queries the database.

Scope boundary: this is a *global dollar budget*. The per-identity daily
message quota (issue #282) lives in ``anon_quota.py`` and its own
``anon_daily_message_count`` table — a separate durable counter, not a read
of this module's ``daily_usage`` table.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from animichi.application.admission_limits import (
    BudgetVerdict,
    anonymous_budget_verdict,
    utc_today,
)
from animichi.application.identity import (
    ANON_USER_ID_PREFIX,
    ANONYMOUS_USER_TYPE,
    UsageScope,
    is_anonymous_identity,
    scope_for_identity,
)
from animichi.application.model_turn_port import ModelTurnUsage
from animichi.domain.ports import UsageMeter
from animichi.infrastructure.persistence.repositories.usage import (
    SQLModelUsageRepository,
)

logger = structlog.get_logger(__name__)

#: Re-exported for every consumer that imports the canonical payer-scope
#: classification and the budget breaker from this module (the definitions
#: live in application.identity / application.admission_limits).
__all__ = [
    "ANON_BUDGET_EXHAUSTED_CODE",
    "ANON_USER_ID_PREFIX",
    "ANONYMOUS_USER_TYPE",
    "BudgetVerdict",
    "UsageScope",
    "anonymous_budget_verdict",
    "is_anonymous_identity",
    "record_turn_usage",
    "record_turn_usage_on",
    "scope_for_identity",
    "usage_cost_usd",
    "utc_today",
]

ANON_BUDGET_EXHAUSTED_CODE = "anon_budget_exhausted"

_TOKENS_PER_MILLION = 1_000_000
#: Metering is best-effort and runs from ``RuntimeAPI.handle``'s ``finally``, so
#: nothing it raises may replace a successful turn's return value. An explicit
#: tuple cannot express that: SQLAlchemy's statement/dialect errors derive
#: straight from ``Exception``, so the most likely real failures — a missing
#: ``daily_usage`` table on a deploy that outran its migration, a missing
#: grant, an engine disposal — would escape a narrower catch and surface
#: as a user-facing turn failure. The budget read has the same requirement: its
#: contract is to fail *open*, and a ``StatementError`` escaping would instead
#: 500 every anonymous turn. Both log with the exception attached, so a swallowed
#: programming error is still visible in the logs rather than silent.
_METER_ERRORS = Exception


@dataclass(frozen=True)
class UsagePrices:
    """Per-million-token prices; configuration, never literals in the logic."""

    input_usd_per_mtok: float
    output_usd_per_mtok: float


def usage_cost_usd(usage: ModelTurnUsage, prices: UsagePrices) -> float:
    """Price one turn's token usage. Unpriced models meter tokens at zero cost."""
    input_usd = usage.prompt_tokens * prices.input_usd_per_mtok
    output_usd = usage.completion_tokens * prices.output_usd_per_mtok
    return (input_usd + output_usd) / _TOKENS_PER_MILLION


async def record_turn_usage(
    usage_repo: UsageMeter | None,
    *,
    usage: ModelTurnUsage | None,
    scope: UsageScope,
    prices: UsagePrices,
    today: date | None = None,
) -> None:
    """Accumulate one turn into ``daily_usage``; best-effort, never fatal."""
    if usage_repo is None or usage is None:
        return
    try:
        await usage_repo.accumulate_usage(
            usage_date=today or utc_today(),
            scope=scope,
            requests=usage.requests,
            input_tokens=usage.prompt_tokens,
            output_tokens=usage.completion_tokens,
            cost_usd=usage_cost_usd(usage, prices),
        )
    except _METER_ERRORS:
        logger.warning("daily_usage_record_failed", scope=scope, exc_info=True)


async def record_turn_usage_on(
    session: AsyncSession,
    usage_repo: SQLModelUsageRepository | None,
    *,
    usage: ModelTurnUsage | None,
    scope: UsageScope,
    prices: UsagePrices,
    today: date | None = None,
) -> None:
    """Accumulate one turn into ``daily_usage`` on a shared transaction (AC5)."""
    if usage_repo is None or usage is None:
        return
    try:
        await usage_repo.accumulate_usage_on(
            session,
            usage_date=today or utc_today(),
            scope=scope,
            requests=usage.requests,
            input_tokens=usage.prompt_tokens,
            output_tokens=usage.completion_tokens,
            cost_usd=usage_cost_usd(usage, prices),
        )
    except _METER_ERRORS:
        logger.warning("daily_usage_record_failed", scope=scope, exc_info=True)
