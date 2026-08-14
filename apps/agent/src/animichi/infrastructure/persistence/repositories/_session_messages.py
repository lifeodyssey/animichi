"""Transcript/message helpers for the Session repository (#994).

``_SessionMessagesMixin`` implements message appends, ordered transcript
reads, and the revision CAS token; ``_SessionHistoryMixin`` owns the
access-checked history page. Split out of ``session.py`` (1-10-50).
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.dml import Insert
from sqlalchemy.sql.selectable import Select

from animichi.domain.repo_types import ResponseData
from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.models import (
    message_table,
    reservation_table,
    session_table,
)
from animichi.infrastructure.persistence.repositories._session_records import (
    HistoryPage,
    MessageRow,
    _as_datetime,
)


def _message_insert(
    session_id: str,
    role: str,
    content: str,
    response_data: ResponseData | None,
) -> Insert:
    return pg_insert(message_table).values(
        session_id=session_id,
        role=role,
        content=content,
        response_data=response_data,
    )


def _message_columns() -> Select:
    "The transcript columns read back in order."
    return select(
        message_table.c.role,
        message_table.c.content,
        message_table.c.response_data,
        message_table.c.created_at,
    )


def _messages_select(
    session_id: str,
    limit: int,
    offset: int,
) -> Select:
    return (
        _message_columns()
        .where(message_table.c.session_id == session_id)
        .order_by(message_table.c.created_at.asc())
        .limit(limit)
        .offset(offset)
    )


def _coerce_message(row: Row[tuple[object, ...]]) -> MessageRow:
    return MessageRow(
        role=str(row.role),
        content=str(row.content),
        response_data=row.response_data,
        created_at=_as_datetime(row.created_at),
    )


def _revision_select(session_id: str) -> Select:
    return select(
        func.coalesce(func.max(reservation_table.c.revision), 0),
    ).where(
        reservation_table.c.session_id.is_not_distinct_from(session_id),
    )


async def _message_rows(
    session: AsyncSession,
    session_id: str,
    limit: int,
    offset: int,
) -> list[MessageRow]:
    rows = await session.execute(
        _messages_select(session_id, limit, offset),
    )
    return [_coerce_message(row) for row in rows.all()]


async def _session_owned(
    sessionmaker: AsyncSessionFactory,
    session_id: str,
    user_id: str,
) -> bool:
    "True when the session exists and belongs to ``user_id``."
    async with sessionmaker() as session:
        result = await session.execute(
            select(session_table.c.id).where(
                session_table.c.id == session_id,
                session_table.c.user_id == user_id,
            )
        )
        return result.scalar_one_or_none() is not None


async def _message_append(
    sessionmaker: AsyncSessionFactory,
    session_id: str,
    role: str,
    content: str,
    response_data: ResponseData | None,
) -> None:
    async with sessionmaker() as session:
        async with session.begin():
            await session.execute(
                _message_insert(session_id, role, content, response_data),
            )


async def _history_page(
    sessionmaker: AsyncSessionFactory,
    session_id: str,
    user_id: str,
    limit: int,
    offset: int,
) -> HistoryPage | None:
    "The owned transcript window with its revision, or ``None`` when unowned."
    if not await _session_owned(sessionmaker, session_id, user_id):
        return None
    async with sessionmaker() as session:
        messages = await _message_rows(session, session_id, limit, offset)
        revision = await _revision_of(session, session_id)
    return _compose_history(user_id, messages, revision)


async def _revision_of(session: AsyncSession, session_id: str) -> int:
    "The latest durable revision for one session."
    result = await session.execute(_revision_select(session_id))
    return int(result.scalar_one())


def _compose_history(
    user_id: str, messages: list[MessageRow], revision: int
) -> HistoryPage:
    "Assemble the owned history page."
    return HistoryPage(
        user_id=user_id,
        messages=messages,
        revision=revision,
    )


class _SessionMessagesMixin:
    """Private transcript + revision helpers shared by the session store."""

    _sessionmaker: AsyncSessionFactory

    async def _owns_session(self, session_id: str, user_id: str) -> bool:
        return await _session_owned(self._sessionmaker, session_id, user_id)

    async def insert_message(
        self,
        session_id: str,
        role: str,
        content: str,
        response_data: ResponseData | None = None,
    ) -> None:
        await _message_append(
            self._sessionmaker,
            session_id,
            role,
            content,
            response_data,
        )

    async def insert_message_on(
        self,
        session: AsyncSession,
        session_id: str,
        role: str,
        content: str,
        response_data: ResponseData | None = None,
    ) -> None:
        """Append one transcript row on a caller-owned transaction (AC5)."""
        await session.execute(
            _message_insert(session_id, role, content, response_data),
        )

    async def get_messages(
        self,
        session_id: str,
        *,
        limit: int = 100,
        offset: int = 0,
    ) -> list[MessageRow]:
        async with self._sessionmaker() as session:
            return await _message_rows(session, session_id, limit, offset)

    async def current_revision(self, session_id: str) -> int:
        async with self._sessionmaker() as session:
            result = await session.execute(_revision_select(session_id))
            return int(result.scalar_one())


class _SessionHistoryMixin:
    """Access-checked transcript history page shared by the session store."""

    _sessionmaker: AsyncSessionFactory

    async def history(
        self,
        session_id: str,
        user_id: str,
        *,
        limit: int,
        offset: int,
    ) -> HistoryPage | None:
        return await _history_page(
            self._sessionmaker,
            session_id,
            user_id,
            limit,
            offset,
        )


__all__ = ["_SessionHistoryMixin", "_SessionMessagesMixin"]
