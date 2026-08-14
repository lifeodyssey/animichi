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
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, literal, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from animichi.application.adopt_sessions import (
    ADOPT_TURN_KEY_PREFIX,
    AdoptionResult,
)
from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.models import (
    message_table,
    reservation_table,
    session_table,
)


def _as_text(value: object) -> str:
    return str(value) if isinstance(value, str) else ""


def _as_state(raw: object) -> dict[str, object] | None:
    if isinstance(raw, str):
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    if isinstance(raw, Mapping):
        return dict(raw)
    return None


def _as_datetime(raw: object) -> str:
    """Serialize a stored timestamp to the wire form used by the legacy path."""
    if isinstance(raw, datetime):
        return raw.isoformat()
    return str(raw)


@dataclass(frozen=True)
class SessionRecord:
    session_id: str
    user_id: str
    title: str | None = None
    first_query: str | None = None
    state: dict[str, object] | None = None
    metadata: dict[str, object] | None = None


@dataclass(frozen=True)
class MessageRow:
    role: str
    content: str
    response_data: object | None
    created_at: str


@dataclass(frozen=True)
class HistoryPage:
    user_id: str
    messages: list[MessageRow]
    revision: int


class SQLModelSessionRepository:
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
        async with self._sessionmaker() as session:
            result = await session.execute(
                select(session_table.c.id).where(
                    session_table.c.id == session_id,
                    session_table.c.user_id == user_id,
                )
            )
            return result.scalar_one_or_none() is not None

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
        if not await self.check_session_owner(session_id, user_id):
            return None
        messages = await self.get_messages(session_id, limit=limit, offset=offset)
        return HistoryPage(
            user_id=user_id,
            messages=messages,
            revision=await self.current_revision(session_id),
        )

    async def adopt_ownership(
        self, from_anon_id: str, to_user_id: str
    ) -> AdoptionResult:
        """Adopt every anonymous-owned Session and bump its revision so
        pre-adoption capabilities go stale (one identity-dimensional UPDATE,
        transactional with the bumps, idempotent on a second run)."""
        async with self._sessionmaker() as session:
            async with session.begin():
                adopted = (
                    (
                        await session.execute(
                            session_table.update()
                            .where(session_table.c.user_id == from_anon_id)
                            .values(user_id=to_user_id, updated_at=func.now())
                            .returning(session_table.c.id)
                        )
                    )
                    .scalars()
                    .all()
                )
                bumped = 0
                for adopted_session_id in adopted:
                    bumped += int(
                        await self._bump_revision(session, str(adopted_session_id))
                    )
                return AdoptionResult(
                    adopted_count=len(adopted), revisions_bumped=bumped
                )

    async def _bump_revision(
        self, session: AsyncSession, adopted_session_id: str
    ) -> int:
        """Advance one adopted session's revision; 1 when the marker landed.

        Mirrors the legacy ``INSERT ... SELECT`` exactly: the marker is only
        written when the session already has a reservation row, uses the
        synthetic ``adopt:`` turn_key namespace with the fixed ``anon`` payer,
        and is a no-op on a concurrent revision race.
        """
        source = select(
            literal(adopted_session_id),
            literal(ADOPT_TURN_KEY_PREFIX + adopted_session_id),
            literal("anon"),
            literal(None),
            func.coalesce(func.max(reservation_table.c.revision), 0) + 1,
            literal(None),
            literal("completed"),
        ).where(reservation_table.c.session_id == adopted_session_id)
        statement = (
            pg_insert(reservation_table)
            .from_select(
                [
                    "session_id",
                    "turn_key",
                    "payer",
                    "identity_id",
                    "revision",
                    "digest",
                    "status",
                ],
                source,
            )
            .on_conflict_do_nothing(constraint="turn_reservations_session_revision")
            .returning(reservation_table.c.session_id)
        )
        result = await session.execute(statement)
        return 1 if result.scalar_one_or_none() is not None else 0


__all__ = ["HistoryPage", "MessageRow", "SQLModelSessionRepository", "SessionRecord"]
