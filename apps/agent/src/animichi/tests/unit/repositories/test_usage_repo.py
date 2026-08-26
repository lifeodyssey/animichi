"""Unit tests for the SQLModel daily-usage meter (#995).

Behavior-level assertions on the typed statements the repository builds —
no SQL strings are compared and nothing is executed (raw-SQL policy, #999).
The real-Postgres behavior is covered by the integration contract suite.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.dialects.postgresql.dml import Insert

from animichi.infrastructure.persistence.models import daily_usage_table
from animichi.infrastructure.persistence.repositories.usage import (
    SQLModelUsageRepository,
)
from animichi.tests.unit.repositories._session_fake import RecordingSessionFactory

TODAY = date(2026, 7, 26)


def _only_statement(factory: RecordingSessionFactory) -> Insert:
    assert len(factory.session.executed) == 1
    statement = factory.session.executed[0]
    assert isinstance(statement, Insert)
    return statement


async def test_accumulate_usage_builds_an_upsert_on_the_day_scope_key() -> None:
    factory = RecordingSessionFactory()
    repo = SQLModelUsageRepository(factory)

    await repo.accumulate_usage(
        usage_date=TODAY,
        scope="anon",
        requests=1,
        input_tokens=100,
        output_tokens=50,
        cost_usd=0.25,
    )

    statement = _only_statement(factory)
    assert statement.table is daily_usage_table
    assert statement._values["usage_date"].value == TODAY
    assert statement._values["scope"].value == "anon"
    assert statement._values["cost_usd"].value == Decimal("0.25")


async def test_accumulate_usage_conflicts_on_the_day_scope_key() -> None:
    factory = RecordingSessionFactory()
    repo = SQLModelUsageRepository(factory)

    await repo.accumulate_usage(
        usage_date=TODAY,
        scope="anon",
        requests=1,
        input_tokens=100,
        output_tokens=50,
        cost_usd=0.25,
    )

    conflict = _only_statement(factory)._post_values_clause
    assert list(conflict.inferred_target_elements) == [
        daily_usage_table.c.usage_date,
        daily_usage_table.c.scope,
    ]
    assert daily_usage_table.c.requests.name in dict(conflict.update_values_to_set)
    assert daily_usage_table.c.cost_usd.name in dict(conflict.update_values_to_set)


async def test_total_cost_usd_converts_the_numeric_column_to_a_float() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(Decimal("4.125"))
    repo = SQLModelUsageRepository(factory)

    assert await repo.total_cost_usd(usage_date=TODAY, scope="anon") == 4.125


async def test_total_cost_usd_is_zero_for_a_day_with_no_usage() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(None)
    repo = SQLModelUsageRepository(factory)

    assert await repo.total_cost_usd(usage_date=TODAY, scope="anon") == 0.0


async def test_total_cost_usd_is_zero_when_the_column_is_null() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(None)
    repo = SQLModelUsageRepository(factory)

    assert await repo.total_cost_usd(usage_date=TODAY, scope="anon") == 0.0


async def test_total_cost_usd_propagates_a_database_error() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(error=RuntimeError)
    repo = SQLModelUsageRepository(factory)

    with pytest.raises(RuntimeError):
        await repo.total_cost_usd(usage_date=TODAY, scope="anon")
