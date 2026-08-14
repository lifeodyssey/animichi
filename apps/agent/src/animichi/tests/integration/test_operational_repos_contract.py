"""Real-Postgres contract for the remaining operational repositories (#995).

Feedback + request-log (AGENT-3 #962) and the daily-usage meter (S1.8)
through the SQLModel repositories' public methods — typed SQLAlchemy
statements only, no raw SQL (raw-SQL policy, #999). Rows are isolated per
test and cleaned through the repositories' own tables.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy import delete

from animichi.infrastructure.persistence.database import (
    DatabaseLifecycle,
    create_database_lifecycle,
)
from animichi.infrastructure.persistence.models import (
    feedback_table,
    request_log_table,
)
from animichi.infrastructure.persistence.repositories.feedback import (
    SQLModelFeedbackRepository,
)
from animichi.infrastructure.persistence.repositories.usage import (
    SQLModelUsageRepository,
)
from animichi.tests.conftest_db import DatabaseTarget

pytestmark = pytest.mark.integration


def _marker() -> str:
    return f"contract-{uuid4().hex[:10]}"


@pytest.fixture
async def feedback_repo(
    pg_container: DatabaseTarget,
) -> AsyncIterator[SQLModelFeedbackRepository]:
    lifecycle: DatabaseLifecycle = create_database_lifecycle(pg_container.dsn)
    try:
        yield SQLModelFeedbackRepository(lifecycle.sessionmaker)
    finally:
        await lifecycle.close()


@pytest.fixture
async def usage_repo(
    pg_container: DatabaseTarget,
) -> AsyncIterator[SQLModelUsageRepository]:
    lifecycle: DatabaseLifecycle = create_database_lifecycle(pg_container.dsn)
    try:
        yield SQLModelUsageRepository(lifecycle.sessionmaker)
    finally:
        await lifecycle.close()


async def _clear_feedback(repo: SQLModelFeedbackRepository, marker: str) -> None:
    async with repo._sessionmaker() as session:
        async with session.begin():
            await session.execute(
                delete(request_log_table).where(
                    request_log_table.c.query_text.like(f"{marker}-%")
                )
            )
            await session.execute(
                delete(feedback_table).where(
                    feedback_table.c.query_text.like(f"{marker}-%")
                )
            )


async def test_feedback_and_request_log_roundtrip(
    feedback_repo: SQLModelFeedbackRepository,
) -> None:
    marker = _marker()
    await _clear_feedback(feedback_repo, marker)
    try:
        feedback_id = await feedback_repo.save_feedback(
            session_id=None,
            query_text=f"{marker}-nice",
            intent="search_bangumi",
            rating="good",
            comment="Helpful!",
        )
        log_id = await feedback_repo.insert_request_log(
            session_id=None,
            query_text=f"{marker}-q",
            locale="ja",
            plan_steps=["resolve_anime", "search_bangumi"],
            intent="search_bangumi",
            status="ok",
            latency_ms=123,
        )

        from uuid import UUID

        assert UUID(feedback_id).version == 7
        assert UUID(log_id).version == 7

        bad = await feedback_repo.fetch_bad_feedback(limit=10)
        assert all(row["query_text"] != f"{marker}-nice" for row in bad)

        unscored = await feedback_repo.fetch_request_log_unscored(limit=10)
        matching = [row for row in unscored if row["query_text"] == f"{marker}-q"]
        assert len(matching) == 1
        assert matching[0]["plan_steps"] == ["resolve_anime", "search_bangumi"]
    finally:
        await _clear_feedback(feedback_repo, marker)


async def test_bad_feedback_is_scored_and_scored_logs_leave_the_queue(
    feedback_repo: SQLModelFeedbackRepository,
) -> None:
    marker = _marker()
    await _clear_feedback(feedback_repo, marker)
    try:
        feedback_id = await feedback_repo.save_feedback(
            session_id=None,
            query_text=f"{marker}-bad",
            intent="search_bangumi",
            rating="bad",
            comment="Wrong answer",
        )
        log_id = await feedback_repo.insert_request_log(
            session_id=None,
            query_text=f"{marker}-q",
            locale="ja",
            plan_steps=None,
            intent="search_bangumi",
            status="ok",
            latency_ms=None,
        )

        bad = await feedback_repo.fetch_bad_feedback(limit=10)
        assert any(row["query_text"] == f"{marker}-bad" for row in bad)

        await feedback_repo.update_request_log_score(log_id=log_id, score=0.9)

        unscored = await feedback_repo.fetch_request_log_unscored(limit=100)
        assert all(row["query_text"] != f"{marker}-q" for row in unscored)
        assert feedback_id
    finally:
        await _clear_feedback(feedback_repo, marker)


async def test_usage_accumulates_and_reads_back_the_day_scope_total(
    usage_repo: SQLModelUsageRepository,
) -> None:
    from animichi.infrastructure.persistence.models import daily_usage_table

    today = date(2026, 8, 11)
    scope = "user"
    async with usage_repo._sessionmaker() as session:
        async with session.begin():
            await session.execute(
                delete(daily_usage_table).where(
                    daily_usage_table.c.usage_date == today,
                    daily_usage_table.c.scope == scope,
                )
            )
    await usage_repo.accumulate_usage(
        usage_date=today,
        scope=scope,
        requests=1,
        input_tokens=100,
        output_tokens=50,
        cost_usd=0.25,
    )
    await usage_repo.accumulate_usage(
        usage_date=today,
        scope=scope,
        requests=2,
        input_tokens=200,
        output_tokens=100,
        cost_usd=0.5,
    )

    assert await usage_repo.total_cost_usd(usage_date=today, scope=scope) == 0.75
