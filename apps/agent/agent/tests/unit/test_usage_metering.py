"""Usage metering and the anonymous daily-budget breaker (issue #274 / S1.8)."""

from __future__ import annotations

from datetime import UTC, date, datetime

from asyncpg.exceptions import UndefinedTableError
from pydantic_ai.usage import RunUsage

from agent.interfaces.usage_metering import (
    UsagePrices,
    anonymous_budget_verdict,
    record_turn_usage,
    scope_for_identity,
    usage_cost_usd,
    utc_today,
)

PRICES = UsagePrices(input_usd_per_mtok=2.0, output_usd_per_mtok=8.0)
TODAY = date(2026, 7, 26)


class _UsageRepoDouble:
    """Records accumulations and serves a fixed running total."""

    def __init__(self, total: float = 0.0) -> None:
        self.total = total
        self.calls: list[tuple[date, str, float]] = []

    async def accumulate_usage(
        self,
        *,
        usage_date: date,
        scope: str,
        requests: int,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> None:
        del requests, input_tokens, output_tokens
        self.calls.append((usage_date, scope, cost_usd))

    async def total_cost_usd(self, *, usage_date: date, scope: str) -> float:
        del usage_date, scope
        return self.total


class _Db:
    def __init__(self, usage: object) -> None:
        self.usage = usage


class _FailingRepo(_UsageRepoDouble):
    async def total_cost_usd(self, *, usage_date: date, scope: str) -> float:
        del usage_date, scope
        raise OSError("meter unavailable")


def test_anonymous_user_type_is_metered_as_anon_scope() -> None:
    assert scope_for_identity("anon_abc", "anonymous") == "anon"


def test_anonymous_id_prefix_alone_is_enough_to_classify_as_anon() -> None:
    assert scope_for_identity("anon_abc", None) == "anon"


def test_logged_in_traffic_is_metered_as_user_scope() -> None:
    assert scope_for_identity("user-1", "human") == "user"


def test_cost_prices_input_and_output_tokens_separately() -> None:
    usage = RunUsage(input_tokens=1_000_000, output_tokens=500_000)
    assert usage_cost_usd(usage, PRICES) == 6.0


def test_an_unpriced_model_meters_tokens_at_zero_cost() -> None:
    free = UsagePrices(input_usd_per_mtok=0.0, output_usd_per_mtok=0.0)
    assert usage_cost_usd(RunUsage(input_tokens=9_999), free) == 0.0


def test_utc_today_reads_the_injected_clock_in_utc() -> None:
    assert utc_today(datetime(2026, 7, 26, 23, 30, tzinfo=UTC)) == TODAY


async def test_record_turn_usage_banks_the_turn_under_its_scope() -> None:
    repo = _UsageRepoDouble()
    usage = RunUsage(input_tokens=1_000_000, output_tokens=0)
    await record_turn_usage(
        _Db(repo), usage=usage, scope="anon", prices=PRICES, today=TODAY
    )
    assert repo.calls == [(TODAY, "anon", 2.0)]


async def test_record_turn_usage_ignores_a_turn_without_usage() -> None:
    repo = _UsageRepoDouble()
    await record_turn_usage(
        _Db(repo), usage=None, scope="anon", prices=PRICES, today=TODAY
    )
    assert repo.calls == []


async def test_record_turn_usage_is_a_noop_without_a_usage_repo() -> None:
    await record_turn_usage(
        object(), usage=RunUsage(), scope="anon", prices=PRICES, today=TODAY
    )


async def test_budget_verdict_trips_once_spend_reaches_the_ceiling() -> None:
    verdict = await anonymous_budget_verdict(
        _Db(_UsageRepoDouble(total=5.0)), budget_usd=5.0, today=TODAY
    )
    assert verdict.exhausted is True
    assert verdict.spent_usd == 5.0


async def test_budget_verdict_allows_spend_below_the_ceiling() -> None:
    verdict = await anonymous_budget_verdict(
        _Db(_UsageRepoDouble(total=4.99)), budget_usd=5.0, today=TODAY
    )
    assert verdict.exhausted is False


async def test_a_zero_budget_disables_the_breaker() -> None:
    verdict = await anonymous_budget_verdict(
        _Db(_UsageRepoDouble(total=99.0)), budget_usd=0.0, today=TODAY
    )
    assert verdict.exhausted is False


async def test_a_meter_read_failure_fails_open() -> None:
    verdict = await anonymous_budget_verdict(
        _Db(_FailingRepo(total=99.0)), budget_usd=5.0, today=TODAY
    )
    assert verdict.exhausted is False


async def test_budget_verdict_is_inert_without_a_usage_repo() -> None:
    verdict = await anonymous_budget_verdict(object(), budget_usd=5.0, today=TODAY)
    assert verdict.exhausted is False


class _PgFailingRepo(_UsageRepoDouble):
    """asyncpg's errors derive straight from Exception, not from OSError."""

    async def accumulate_usage(self, **kwargs: object) -> None:
        del kwargs
        raise UndefinedTableError('relation "daily_usage" does not exist')

    async def total_cost_usd(self, *, usage_date: date, scope: str) -> float:
        del usage_date, scope
        raise UndefinedTableError('relation "daily_usage" does not exist')


async def test_a_missing_daily_usage_table_never_escapes_the_meter() -> None:
    """A deploy that outruns its migration must not fail the turn it meters.

    Metering runs from ``RuntimeAPI.handle``'s ``finally``; anything raised there
    replaces a successful turn's return value. ``UndefinedTableError`` derives
    from ``Exception``, so a narrower except-tuple lets it through.
    """
    await record_turn_usage(
        _Db(_PgFailingRepo()),
        usage=RunUsage(requests=1, input_tokens=100, output_tokens=50),
        scope="anon",
        prices=PRICES,
        today=TODAY,
    )


async def test_a_postgres_read_failure_fails_the_budget_breaker_open() -> None:
    """The breaker's contract is fail-open; a DB error must not 500 every turn."""
    verdict = await anonymous_budget_verdict(
        _Db(_PgFailingRepo()), budget_usd=5.0, today=TODAY
    )
    assert verdict.exhausted is False
