"""SQLModel feedback + request-audit repository (#995).

Replaces the asyncpg ``FeedbackRepository``: the same feedback-write, audit
write, and operator read/score contracts against ``feedback`` and
``request_log``, expressed with SQLModel/SQLAlchemy statements. Both tables
own database-generated UUIDv7 ids returned by ``RETURNING``.

The select/insert builders are module-level pure functions (1-10-50); the
write/read mixins are thin wrappers around module-level flow functions.
"""

from __future__ import annotations

from typing import cast

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.dml import ReturningInsert, Update
from sqlalchemy.sql.selectable import Select

from animichi.domain.repo_types import FeedbackBadRow, RequestLogUnscoredRow
from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.models import feedback_table, request_log_table


def _require_id(raw: object, *, operation: str) -> str:
    if raw is None:
        raise RuntimeError(f"Database did not return a row for {operation}")
    return str(raw)


def _feedback_values(
    session_id: str | None,
    query_text: str,
    intent: str | None,
    rating: str,
    comment: str | None,
) -> dict[str, object]:
    "The insert columns for one feedback row."
    return {
        "session_id": session_id,
        "query_text": query_text,
        "intent": intent,
        "rating": rating,
        "comment": comment,
    }


def _feedback_insert(
    session_id: str | None,
    query_text: str,
    intent: str | None,
    rating: str,
    comment: str | None,
) -> ReturningInsert:
    return (
        pg_insert(feedback_table)
        .values(**_feedback_values(session_id, query_text, intent, rating, comment))
        .returning(feedback_table.c.id)
    )


def _request_log_values(
    session_id: str | None,
    query_text: str,
    locale: str,
    plan_steps: list[str] | None,
    intent: str | None,
    status: str,
    latency_ms: int | None,
) -> dict[str, object]:
    "The insert columns for one request-audit row."
    return {
        "session_id": session_id,
        "query_text": query_text,
        "locale": locale,
        "plan_steps": plan_steps,
        "intent": intent,
        "status": status,
        "latency_ms": latency_ms,
    }


def _request_log_insert(
    session_id: str | None,
    query_text: str,
    locale: str,
    plan_steps: list[str] | None,
    intent: str | None,
    status: str,
    latency_ms: int | None,
) -> ReturningInsert:
    return (
        pg_insert(request_log_table)
        .values(
            **_request_log_values(
                session_id, query_text, locale, plan_steps, intent, status, latency_ms
            )
        )
        .returning(request_log_table.c.id)
    )


def _bad_feedback_columns() -> Select:
    "The operator-read columns for one bad-feedback row."
    return select(
        feedback_table.c.id,
        feedback_table.c.query_text,
        feedback_table.c.intent,
        feedback_table.c.comment,
        feedback_table.c.created_at,
    )


def _bad_feedback_select(limit: int) -> Select:
    "Most recent bad feedback, newest first."
    return (
        _bad_feedback_columns()
        .where(feedback_table.c.rating == "bad")
        .order_by(feedback_table.c.created_at.desc())
        .limit(limit)
    )


def _unscored_columns() -> Select:
    "The operator-read columns for one unscored log row."
    return select(
        request_log_table.c.id,
        request_log_table.c.query_text,
        request_log_table.c.locale,
        request_log_table.c.plan_steps,
        request_log_table.c.intent,
    )


def _unscored_select(limit: int) -> Select:
    "Successful turns awaiting a plan-quality score."
    return (
        _unscored_columns()
        .where(
            request_log_table.c.plan_quality_score.is_(None),
            request_log_table.c.status == "ok",
        )
        .order_by(request_log_table.c.created_at.desc())
        .limit(limit)
    )


def _score_update(log_id: str, score: float) -> Update:
    """Attach one plan-quality score to a log row."""
    return (
        update(request_log_table)
        .where(request_log_table.c.id == log_id)
        .values(plan_quality_score=score)
    )


async def _save_feedback(
    sessionmaker: AsyncSessionFactory,
    session_id: str | None,
    query_text: str,
    intent: str | None,
    rating: str,
    comment: str | None,
) -> str:
    "Insert one feedback row; returns the feedback UUID."
    async with sessionmaker() as session:
        async with session.begin():
            raw = (
                await session.execute(
                    _feedback_insert(session_id, query_text, intent, rating, comment)
                )
            ).scalar_one_or_none()
    return _require_id(raw, operation="save_feedback")


async def _insert_request_log(
    sessionmaker: AsyncSessionFactory,
    session_id: str | None,
    query_text: str,
    locale: str,
    plan_steps: list[str] | None,
    intent: str | None,
    status: str,
    latency_ms: int | None,
) -> str:
    "Insert one audit row; returns the request-log UUID."
    async with sessionmaker() as session:
        async with session.begin():
            statement = _request_log_insert(
                session_id, query_text, locale, plan_steps, intent, status, latency_ms
            )
            raw = (await session.execute(statement)).scalar_one_or_none()
    return _require_id(raw, operation="insert_request_log")


async def _insert_request_log_on(
    session: AsyncSession,
    session_id: str | None,
    query_text: str,
    locale: str,
    plan_steps: list[str] | None,
    intent: str | None,
    status: str,
    latency_ms: int | None,
) -> str:
    "Insert one audit row on a caller-owned transaction; returns the UUID."
    statement = _request_log_insert(
        session_id, query_text, locale, plan_steps, intent, status, latency_ms
    )
    raw = (await session.execute(statement)).scalar_one_or_none()
    return _require_id(raw, operation="insert_request_log")


async def _fetch_bad_feedback(
    sessionmaker: AsyncSessionFactory, limit: int
) -> list[FeedbackBadRow]:
    "Operator read: most recent bad feedback, newest first."
    async with sessionmaker() as session:
        rows = await session.execute(_bad_feedback_select(limit))
    return [cast(FeedbackBadRow, dict(row._mapping)) for row in rows.all()]


async def _fetch_unscored(
    sessionmaker: AsyncSessionFactory, limit: int
) -> list[RequestLogUnscoredRow]:
    "Operator read: successful turns awaiting a plan-quality score."
    async with sessionmaker() as session:
        rows = await session.execute(_unscored_select(limit))
    return [cast(RequestLogUnscoredRow, dict(row._mapping)) for row in rows.all()]


async def _update_score(
    sessionmaker: AsyncSessionFactory, log_id: str, score: float
) -> None:
    "Operator write: attach one plan-quality score to a log row."
    async with sessionmaker() as session:
        async with session.begin():
            await session.execute(_score_update(log_id, score))


class _FeedbackWriteMixin:
    """Feedback + audit write operations over one session factory."""

    _sessionmaker: AsyncSessionFactory

    async def save_feedback(
        self,
        session_id: str | None,
        query_text: str,
        intent: str | None,
        rating: str,
        comment: str | None = None,
    ) -> str:
        """Insert one feedback row; returns the feedback UUID."""
        return await _save_feedback(
            self._sessionmaker, session_id, query_text, intent, rating, comment
        )

    async def insert_request_log(
        self,
        *,
        session_id: str | None,
        query_text: str,
        locale: str,
        plan_steps: list[str] | None,
        intent: str | None,
        status: str,
        latency_ms: int | None,
    ) -> str:
        return await _insert_request_log(
            self._sessionmaker,
            session_id,
            query_text,
            locale,
            plan_steps,
            intent,
            status,
            latency_ms,
        )

    async def insert_request_log_on(
        self,
        session: AsyncSession,
        *,
        session_id: str | None,
        query_text: str,
        locale: str,
        plan_steps: list[str] | None,
        intent: str | None,
        status: str,
        latency_ms: int | None,
    ) -> str:
        return await _insert_request_log_on(
            session,
            session_id,
            query_text,
            locale,
            plan_steps,
            intent,
            status,
            latency_ms,
        )


class _FeedbackReadMixin:
    """Operator feedback + request-log read operations."""

    _sessionmaker: AsyncSessionFactory

    async def fetch_bad_feedback(self, *, limit: int = 100) -> list[FeedbackBadRow]:
        """Operator read: most recent bad feedback, newest first."""
        return await _fetch_bad_feedback(self._sessionmaker, limit)

    async def fetch_request_log_unscored(
        self, *, limit: int = 200
    ) -> list[RequestLogUnscoredRow]:
        """Operator read: successful turns awaiting a plan-quality score."""
        return await _fetch_unscored(self._sessionmaker, limit)

    async def update_request_log_score(self, *, log_id: str, score: float) -> None:
        """Operator write: attach one plan-quality score to a log row."""
        await _update_score(self._sessionmaker, log_id, score)


class SQLModelFeedbackRepository(_FeedbackWriteMixin, _FeedbackReadMixin):
    """Feedback and request-log persistence (AGENT-3 #962, #663)."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker


__all__ = ["SQLModelFeedbackRepository"]
