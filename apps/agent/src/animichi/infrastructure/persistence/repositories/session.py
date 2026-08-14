"""The sole Session aggregate repository on SQLModel/SQLAlchemy (#994).

``SQLModelSessionRepository`` is the single storage surface for the Session
aggregate against the fresh-schema manifest: ``sessions`` (state envelope,
metadata, AND ownership in one row), ``messages`` (the ordered transcript),
and ``turn_reservations`` (the durable revision CAS). It implements create,
load, commit, history, and adoption so AgentTurn, GetSessionHistory, and
AdoptSessions speak one repository — no second-root store exists.

Every public method opens one short-lived :class:`AsyncSession` from the
injected factory; cross-table atomic operations (adoption) run inside one
session transaction, the narrow unit-of-work seam (#994).

Data records and scalar coercion live in ``_session_records``; the transcript
and adoption methods live in ``_session_messages`` / ``_session_adoption``
(1-10-50).
"""

from __future__ import annotations

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.models import session_table
from animichi.infrastructure.persistence.repositories._session_adoption import (
    _SessionAdoptionMixin,
)
from animichi.infrastructure.persistence.repositories._session_messages import (
    _SessionMessagesMixin,
)
from animichi.infrastructure.persistence.repositories._session_records import (
    HistoryPage,
    MessageRow,
    SessionRecord,
    _as_state,
    _as_text,
)


class SQLModelSessionRepository(_SessionMessagesMixin, _SessionAdoptionMixin):
    """The sole Session aggregate repository against the fresh-schema manifest."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker

    async def create(
        self,
        session_id: str,
        user_id: str,
        first_query: str,
        session_state: dict[str, object],
    ) -> None:
        async with self._sessionmaker() as session:
            async with session.begin():
                await session.execute(
                    pg_insert(session_table).values(
                        id=session_id,
                        user_id=user_id,
                        first_query=first_query,
                        state=session_state,
                    )
                )

    async def load(self, session_id: str) -> SessionRecord | None:
        async with self._sessionmaker() as session:
            row = (
                await session.execute(
                    select(
                        session_table.c.id,
                        session_table.c.user_id,
                        session_table.c.title,
                        session_table.c.first_query,
                        session_table.c.state,
                        session_table.c.metadata,
                    ).where(session_table.c.id == session_id)
                )
            ).first()
        if row is None:
            return None
        (
            stored_id,
            stored_user_id,
            stored_title,
            stored_first_query,
            stored_state,
            stored_metadata,
        ) = row
        return SessionRecord(
            session_id=_as_text(stored_id),
            user_id=_as_text(stored_user_id) if stored_user_id is not None else "",
            title=_as_text(stored_title) if stored_title is not None else None,
            first_query=(
                _as_text(stored_first_query) if stored_first_query is not None else None
            ),
            state=_as_state(stored_state),
            metadata=_as_state(stored_metadata),
        )

    async def get_session_state(self, session_id: str) -> dict[str, object] | None:
        async with self._sessionmaker() as session:
            result = await session.execute(
                select(session_table.c.state).where(session_table.c.id == session_id)
            )
            raw = result.scalar_one_or_none()
        return _as_state(raw)

    async def upsert_session_state(
        self, session_id: str, state: dict[str, object]
    ) -> None:
        async with self._sessionmaker() as session:
            async with session.begin():
                statement = pg_insert(session_table).values(
                    id=session_id, state=state, updated_at=func.now()
                )
                await session.execute(
                    statement.on_conflict_do_update(
                        index_elements=[session_table.c.id],
                        set_={
                            "state": statement.excluded.state,
                            "updated_at": func.now(),
                        },
                    )
                )

    async def delete_session_state(self, session_id: str) -> None:
        async with self._sessionmaker() as session:
            async with session.begin():
                await session.execute(
                    session_table.delete().where(session_table.c.id == session_id)
                )

    async def upsert_session(
        self,
        session_id: str,
        session_state: dict[str, object],
        metadata: dict[str, object] | None = None,
        *,
        user_id: str | None = None,
    ) -> None:
        async with self._sessionmaker() as session:
            async with session.begin():
                statement = pg_insert(session_table).values(
                    id=session_id,
                    user_id=user_id,
                    state=session_state,
                    metadata=metadata,
                )
                await session.execute(
                    statement.on_conflict_do_update(
                        index_elements=[session_table.c.id],
                        set_={
                            "state": statement.excluded.state,
                            "metadata": func.coalesce(
                                statement.excluded.metadata,
                                session_table.c.metadata,
                            ),
                            "user_id": func.coalesce(
                                statement.excluded.user_id,
                                session_table.c.user_id,
                            ),
                        },
                    )
                )

    async def check_session_owner(self, session_id: str, user_id: str) -> bool:
        return await self._owns_session(session_id, user_id)

    async def list_sessions(
        self,
        user_id: str,
        *,
        limit: int = 30,
    ) -> list[dict[str, object]]:
        async with self._sessionmaker() as session:
            rows = (
                await session.execute(
                    select(
                        session_table.c.id.label("session_id"),
                        session_table.c.title,
                        session_table.c.first_query,
                        session_table.c.created_at,
                        session_table.c.updated_at,
                    )
                    .where(session_table.c.user_id == user_id)
                    .order_by(session_table.c.updated_at.desc())
                    .limit(limit)
                )
            ).all()
        return [dict(row._mapping) for row in rows]

    async def update_title(
        self,
        session_id: str,
        title: str,
        *,
        user_id: str | None = None,
    ) -> bool:
        async with self._sessionmaker() as session:
            async with session.begin():
                statement = (
                    update(session_table)
                    .where(session_table.c.id == session_id)
                    .values(title=title, updated_at=func.now())
                    .returning(session_table.c.id)
                )
                if user_id is not None:
                    statement = statement.where(session_table.c.user_id == user_id)
                result = await session.execute(statement)
                return result.scalar_one_or_none() is not None


__all__ = ["HistoryPage", "MessageRow", "SQLModelSessionRepository", "SessionRecord"]
