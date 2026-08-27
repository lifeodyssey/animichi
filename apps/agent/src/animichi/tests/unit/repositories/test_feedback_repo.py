"""Unit tests for the SQLModel feedback + request-audit repository (#995).

Behavior-level assertions on the typed statements the repository builds — no
SQL strings are compared and nothing is executed (raw-SQL policy, #999).
The real-Postgres insert/receipt behavior is covered by the integration
contract suite.
"""

from __future__ import annotations

import pytest
from sqlalchemy.dialects.postgresql.dml import Insert
from sqlalchemy.sql.elements import ClauseElement

from animichi.infrastructure.persistence.models import feedback_table
from animichi.infrastructure.persistence.repositories.feedback import (
    SQLModelFeedbackRepository,
)
from animichi.tests.unit.repositories._session_fake import RecordingSessionFactory


def _only_statement(factory: RecordingSessionFactory) -> ClauseElement:
    assert len(factory.session.executed) == 1
    return factory.session.executed[0]


async def test_save_feedback_returns_the_returned_feedback_id() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for("fb-uuid-123")
    repo = SQLModelFeedbackRepository(factory)

    result = await repo.save_feedback(
        session_id="sess-1",
        query_text="Where is Liz filmed?",
        intent="search_anime",
        rating="good",
        comment="Helpful!",
    )

    assert result == "fb-uuid-123"
    statement = _only_statement(factory)
    assert isinstance(statement, Insert)
    assert statement.table is feedback_table
    assert statement._values["query_text"].value == "Where is Liz filmed?"
    assert statement._values["rating"].value == "good"
    assert statement._values["comment"].value == "Helpful!"


async def test_save_feedback_raises_when_no_row_returned() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(None)
    repo = SQLModelFeedbackRepository(factory)

    with pytest.raises(RuntimeError, match="save_feedback"):
        await repo.save_feedback(
            session_id="sess-1",
            query_text="test",
            intent=None,
            rating="bad",
        )


async def test_insert_request_log_returns_the_returned_log_id() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for("log-uuid-456")
    repo = SQLModelFeedbackRepository(factory)

    result = await repo.insert_request_log(
        session_id="sess-1",
        query_text="test query",
        locale="ja",
        plan_steps=["resolve_anime", "search_bangumi"],
        intent="search",
        status="ok",
        latency_ms=120,
    )

    assert result == "log-uuid-456"
    statement = _only_statement(factory)
    assert isinstance(statement, Insert)
    assert statement._values["plan_steps"].value == [
        "resolve_anime",
        "search_bangumi",
    ]
    assert statement._values["latency_ms"].value == 120


async def test_fetch_bad_feedback_returns_the_typed_read_rows() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(
        [{"id": "1", "query_text": "bad result", "intent": None}]
    )
    repo = SQLModelFeedbackRepository(factory)

    result = await repo.fetch_bad_feedback(limit=10)

    assert len(result) == 1
    assert result[0]["query_text"] == "bad result"


async def test_fetch_bad_feedback_propagates_a_database_error() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(error=RuntimeError)
    repo = SQLModelFeedbackRepository(factory)

    with pytest.raises(RuntimeError):
        await repo.fetch_bad_feedback(limit=10)


async def test_update_request_log_score_builds_a_scoped_update() -> None:
    from sqlalchemy.sql.dml import Update

    factory = RecordingSessionFactory()
    repo = SQLModelFeedbackRepository(factory)

    await repo.update_request_log_score(log_id="log-1", score=0.85)

    statement = _only_statement(factory)
    assert isinstance(statement, Update)
    assert statement._values["plan_quality_score"].value == 0.85
