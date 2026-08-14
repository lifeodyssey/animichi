"""SQLModel feedback + request-audit repository (#995).

Replaces the asyncpg ``FeedbackRepository``: the same feedback-write, audit
write, and operator read/score contracts against ``feedback`` and
``request_log``, expressed with SQLModel/SQLAlchemy statements. Both tables
own database-generated UUIDv7 ids returned by ``RETURNING``.
"""

from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.models import feedback_table, request_log_table


def _require_id(raw: object, *, operation: str) -> str:
    if raw is None:
        raise RuntimeError(f"Database did not return a row for {operation}")
    return str(raw)


class SQLModelFeedbackRepository:
    """Feedback and request-log persistence (AGENT-3 #962, #663)."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker

    async def save_feedback(
        self,
        session_id: str | None,
        query_text: str,
        intent: str | None,
        rating: str,
        comment: str | None = None,
    ) -> str:
        """Insert one feedback row; returns the feedback UUID."""
        async with self._sessionmaker() as session:
            async with session.begin():
                statement = (
                    pg_insert(feedback_table)
                    .values(
                        session_id=session_id,
                        query_text=query_text,
                        intent=intent,
                        rating=rating,
                        comment=comment,
                    )
                    .returning(feedback_table.c.id)
                )
                raw = (await session.execute(statement)).scalar_one_or_none()
        return _require_id(raw, operation="save_feedback")

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
        """Insert one audit row; returns the request-log UUID."""
        async with self._sessionmaker() as session:
            async with session.begin():
                statement = (
                    pg_insert(request_log_table)
                    .values(
                        session_id=session_id,
                        query_text=query_text,
                        locale=locale,
                        plan_steps=plan_steps,
                        intent=intent,
                        status=status,
                        latency_ms=latency_ms,
                    )
                    .returning(request_log_table.c.id)
                )
                raw = (await session.execute(statement)).scalar_one_or_none()
        return _require_id(raw, operation="insert_request_log")

    async def fetch_bad_feedback(self, *, limit: int = 100) -> list[dict[str, object]]:
        """Operator read: most recent bad feedback, newest first."""
        async with self._sessionmaker() as session:
            rows = (
                await session.execute(
                    select(
                        feedback_table.c.id,
                        feedback_table.c.query_text,
                        feedback_table.c.intent,
                        feedback_table.c.comment,
                        feedback_table.c.created_at,
                    )
                    .where(feedback_table.c.rating == "bad")
                    .order_by(feedback_table.c.created_at.desc())
                    .limit(limit)
                )
            ).all()
        return [dict(row._mapping) for row in rows]

    async def fetch_request_log_unscored(
        self, *, limit: int = 200
    ) -> list[dict[str, object]]:
        """Operator read: successful turns awaiting a plan-quality score."""
        async with self._sessionmaker() as session:
            rows = (
                await session.execute(
                    select(
                        request_log_table.c.id,
                        request_log_table.c.query_text,
                        request_log_table.c.locale,
                        request_log_table.c.plan_steps,
                        request_log_table.c.intent,
                    )
                    .where(
                        request_log_table.c.plan_quality_score.is_(None),
                        request_log_table.c.status == "ok",
                    )
                    .order_by(request_log_table.c.created_at.desc())
                    .limit(limit)
                )
            ).all()
        return [dict(row._mapping) for row in rows]

    async def update_request_log_score(self, *, log_id: str, score: float) -> None:
        """Operator write: attach one plan-quality score to a log row."""
        async with self._sessionmaker() as session:
            async with session.begin():
                await session.execute(
                    update(request_log_table)
                    .where(request_log_table.c.id == log_id)
                    .values(plan_quality_score=score)
                )
