"""Session lifecycle + state mixins for the Session repository (#994).

``_SessionLifecycleMixin`` wraps create/load/list/rename, and
``_SessionStateMixin`` wraps the state get/upsert/delete operations; both
delegate to the module-level statement+flow helpers in ``_session_state``
(1-10-50).
"""

from __future__ import annotations

from animichi.domain.repo_types import SessionListRow, SessionMetadata, SessionStateData
from animichi.infrastructure.persistence.database import AsyncSessionFactory, read_only
from animichi.infrastructure.persistence.repositories._session_messages import (
    _session_owned,
)
from animichi.infrastructure.persistence.repositories._session_records import (
    SessionRecord,
)
from animichi.infrastructure.persistence.repositories._session_state import (
    _create,
    _delete_state,
    _get_state,
    _list,
    _load,
    _update_title,
    _upsert,
    _upsert_state,
)


async def _create_session(
    sessionmaker: AsyncSessionFactory,
    session_id: str,
    user_id: str,
    first_query: str,
    state: SessionStateData,
) -> None:
    async with sessionmaker() as session:
        async with session.begin():
            await _create(session, session_id, user_id, first_query, state)


async def _load_session(
    sessionmaker: AsyncSessionFactory, session_id: str
) -> SessionRecord | None:
    async with read_only(sessionmaker) as session:
        return await _load(session, session_id)


async def _get_session_state(
    sessionmaker: AsyncSessionFactory, session_id: str
) -> SessionStateData | None:
    async with read_only(sessionmaker) as session:
        return await _get_state(session, session_id)


async def _upsert_session_state(
    sessionmaker: AsyncSessionFactory, session_id: str, state: SessionStateData
) -> None:
    async with sessionmaker() as session:
        async with session.begin():
            await _upsert_state(session, session_id, state)


async def _delete_session_state(
    sessionmaker: AsyncSessionFactory, session_id: str
) -> None:
    async with sessionmaker() as session:
        async with session.begin():
            await _delete_state(session, session_id)


async def _upsert_session(
    sessionmaker: AsyncSessionFactory,
    session_id: str,
    state: SessionStateData,
    metadata: SessionMetadata | None,
    user_id: str | None,
) -> None:
    async with sessionmaker() as session:
        async with session.begin():
            await _upsert(session, session_id, state, metadata, user_id)


async def _list_sessions(
    sessionmaker: AsyncSessionFactory, user_id: str, limit: int
) -> list[SessionListRow]:
    async with read_only(sessionmaker) as session:
        return await _list(session, user_id, limit)


async def _update_title_session(
    sessionmaker: AsyncSessionFactory,
    session_id: str,
    title: str,
    user_id: str | None,
) -> bool:
    async with sessionmaker() as session:
        async with session.begin():
            return await _update_title(session, session_id, title, user_id)


class _SessionStateMixin:
    """State get/upsert/delete operations for the session store."""

    _sessionmaker: AsyncSessionFactory

    async def get_session_state(self, session_id: str) -> SessionStateData | None:
        return await _get_session_state(self._sessionmaker, session_id)

    async def upsert_session_state(
        self, session_id: str, state: SessionStateData
    ) -> None:
        await _upsert_session_state(self._sessionmaker, session_id, state)

    async def delete_session_state(self, session_id: str) -> None:
        await _delete_session_state(self._sessionmaker, session_id)


class _SessionLifecycleMixin:
    """Create + load operations for the session store."""

    _sessionmaker: AsyncSessionFactory

    async def create(
        self,
        session_id: str,
        user_id: str,
        first_query: str,
        session_state: SessionStateData,
    ) -> None:
        await _create_session(
            self._sessionmaker, session_id, user_id, first_query, session_state
        )

    async def load(self, session_id: str) -> SessionRecord | None:
        return await _load_session(self._sessionmaker, session_id)


class _SessionMutationMixin:
    """Upsert/list/rename/ownership operations for the session store."""

    _sessionmaker: AsyncSessionFactory

    async def upsert_session(
        self,
        session_id: str,
        session_state: SessionStateData,
        metadata: SessionMetadata | None = None,
        *,
        user_id: str | None = None,
    ) -> None:
        await _upsert_session(
            self._sessionmaker,
            session_id,
            session_state,
            metadata,
            user_id,
        )

    async def check_session_owner(self, session_id: str, user_id: str) -> bool:
        return await _session_owned(self._sessionmaker, session_id, user_id)

    async def list_sessions(
        self, user_id: str, *, limit: int = 30
    ) -> list[SessionListRow]:
        return await _list_sessions(self._sessionmaker, user_id, limit)

    async def update_title(
        self,
        session_id: str,
        title: str,
        *,
        user_id: str | None = None,
    ) -> bool:
        return await _update_title_session(
            self._sessionmaker, session_id, title, user_id
        )


__all__ = [
    "_SessionLifecycleMixin",
    "_SessionMutationMixin",
    "_SessionStateMixin",
]
