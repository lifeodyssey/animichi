"""Transcript/message helpers for the Session repository (#994).

``_SessionMessagesMixin`` implements message appends, ordered transcript
reads, the revision CAS token, and the owned history page. Split out of
``session.py`` (1-10-50).
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

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


class _SessionMessagesMixin:
    """Private transcript + revision helpers shared by the session store."""

    _sessionmaker: AsyncSessionFactory

    async def _owns_session(self, session_id: str, user_id: str) -> bool:
        """Ownership gate shared by the history page and the public owner check."""
        async with self._sessionmaker() as session:
            result = await session.execute(
                select(session_table.c.id).where(
                    session_table.c.id == session_id,
                    session_table.c.user_id == user_id,
                )
            )
            return result.scalar_one_or_none() is not None

    async def insert_message(
        self,
        session_id: str,
        role: str,
        content: str,
        response_data: dict[str, object] | None = None,
    ) -> None:
        async with self._sessionmaker() as session:
            async with session.begin():
                await session.execute(
                    pg_insert(message_table).values(
                        session_id=session_id,
                        role=role,
                        content=content,
                        response_data=response_data,
                    )
                )

    async def get_messages(
        self, session_id: str, *, limit: int = 100, offset: int = 0
    ) -> list[MessageRow]:
        async with self._sessionmaker() as session:
            rows = (
                await session.execute(
                    select(
                        message_table.c.role,
                        message_table.c.content,
                        message_table.c.response_data,
                        message_table.c.created_at,
                    )
                    .where(message_table.c.session_id == session_id)
                    .order_by(message_table.c.created_at.asc())
                    .limit(limit)
                    .offset(offset)
                )
            ).all()
        return [
            MessageRow(
                role=str(row.role),
                content=str(row.content),
                response_data=row.response_data,
                created_at=_as_datetime(row.created_at),
            )
            for row in rows
        ]

    async def current_revision(self, session_id: str) -> int:
        """Return the session's current revision (max ever reserved; the CAS token)."""
        async with self._sessionmaker() as session:
            result = await session.execute(
                select(func.coalesce(func.max(reservation_table.c.revision), 0)).where(
                    reservation_table.c.session_id.is_not_distinct_from(session_id)
                )
            )
            return int(result.scalar_one())

    async def history(
        self,
        session_id: str,
        user_id: str,
        *,
        limit: int,
        offset: int,
    ) -> HistoryPage | None:
        """One owned, ordered transcript page plus the revision; missing/forbidden collapse to None."""
        if not await self._owns_session(session_id, user_id):
            return None
        messages = await self.get_messages(session_id, limit=limit, offset=offset)
        return HistoryPage(
            user_id=user_id,
            messages=messages,
            revision=await self.current_revision(session_id),
        )


__all__ = ["_SessionMessagesMixin"]
