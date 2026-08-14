"""Unit tests for the SQLModel anon-quota counter (#995).

Behavior-level assertions on the typed statements the repository builds — no
SQL strings are compared and nothing is executed (raw-SQL policy, #999).
Concurrency and lost-update guarantees live in the integration contract
suite (`test_anon_quota_repo_contract.py`).
"""

from __future__ import annotations

from datetime import date

from sqlalchemy.dialects.postgresql.dml import Insert

from animichi.infrastructure.persistence.models import anon_quota_table
from animichi.infrastructure.persistence.repositories.anon_quota import (
    SQLModelAnonQuotaRepository,
)
from animichi.tests.unit.repositories._session_fake import RecordingSessionFactory

TODAY = date(2026, 7, 26)
ANON_ID = "anon_0123456789abcdef0123456789abcdef"


def _only_statement(factory: RecordingSessionFactory) -> Insert:
    assert len(factory.session.executed) == 1
    statement = factory.session.executed[0]
    assert isinstance(statement, Insert)
    return statement


async def test_increment_and_count_builds_an_upsert_on_the_day_anon_key() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(1)
    repo = SQLModelAnonQuotaRepository(factory)

    count = await repo.increment_and_count(usage_date=TODAY, anon_id=ANON_ID)

    assert count == 1
    statement = _only_statement(factory)
    assert statement.table is anon_quota_table
    assert statement._values["usage_date"].value == TODAY
    assert statement._values["anon_id"].value == ANON_ID
    assert statement._values["message_count"].value == 1


async def test_increment_and_count_conflicts_on_the_day_anon_key() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(2)
    repo = SQLModelAnonQuotaRepository(factory)

    count = await repo.increment_and_count(usage_date=TODAY, anon_id=ANON_ID)

    assert count == 2
    conflict = _only_statement(factory)._post_values_clause
    assert list(conflict.inferred_target_elements) == [
        anon_quota_table.c.usage_date,
        anon_quota_table.c.anon_id,
    ]
    assert anon_quota_table.c.message_count.name in dict(conflict.update_values_to_set)


async def test_count_for_reads_zero_when_no_row_exists() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(None)
    repo = SQLModelAnonQuotaRepository(factory)

    assert await repo.count_for(usage_date=TODAY, anon_id=ANON_ID) == 0


async def test_count_for_reads_the_stored_count() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(3)
    repo = SQLModelAnonQuotaRepository(factory)

    assert await repo.count_for(usage_date=TODAY, anon_id=ANON_ID) == 3
