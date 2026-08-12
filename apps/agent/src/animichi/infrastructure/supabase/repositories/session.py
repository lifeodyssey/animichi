"""The sole Session aggregate repository (SESSION-3 #961).

``FinalSessionRepository`` is the single storage surface for the Session
aggregate against the fresh-schema manifest: ``sessions`` (state envelope,
metadata, AND ownership in one row), ``messages`` (the ordered transcript),
and ``turn_reservations`` (the durable revision CAS). It implements create,
load, commit, history, and adoption so AgentTurn, GetSessionHistory, and
AdoptSessions speak one repository — no second-root store exists.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass

from animichi.application.adopt_sessions import ADOPT_TURN_KEY_PREFIX, AdoptionResult
from animichi.infrastructure.supabase.client_types import (
    AsyncPGPool,
    PoolConnection,
    Row,
)

_CREATE_SESSION_SQL = """
    INSERT INTO sessions (id, user_id, first_query, state)
    VALUES ($1, $2, $3, $4::jsonb)
"""
_LOAD_SESSION_SQL = """
    SELECT id, user_id, title, first_query, state, metadata
    FROM sessions WHERE id = $1
"""
_LOAD_STATE_SQL = "SELECT state FROM sessions WHERE id = $1"
_UPSERT_STATE_SQL = """
    INSERT INTO sessions (id, state, updated_at)
    VALUES ($1, $2::jsonb, now())
    ON CONFLICT (id)
    DO UPDATE SET state = $2::jsonb, updated_at = now()
"""
#: Records the owner on every committed turn without clobbering an existing one.
_UPSERT_SESSION_SQL = """
    INSERT INTO sessions (id, user_id, state, metadata)
    VALUES ($1, $2, $3::jsonb, $4::jsonb)
    ON CONFLICT (id) DO UPDATE SET
        state = $3::jsonb,
        metadata = COALESCE($4::jsonb, sessions.metadata),
        user_id = COALESCE(EXCLUDED.user_id, sessions.user_id)
"""
_DELETE_SESSION_SQL = "DELETE FROM sessions WHERE id = $1"
_CHECK_OWNER_SQL = "SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2"
_LIST_SESSIONS_SQL = """
    SELECT id AS session_id, title, first_query, created_at, updated_at
    FROM sessions WHERE user_id = $1
    ORDER BY updated_at DESC
    LIMIT $2
"""
_UPDATE_TITLE_SQL = """
    UPDATE sessions SET title = $1, updated_at = now()
    WHERE id = $2 AND user_id = $3
    RETURNING id
"""
_UPDATE_TITLE_ANY_SQL = """
    UPDATE sessions SET title = $1, updated_at = now()
    WHERE id = $2
    RETURNING id
"""
_INSERT_MESSAGE_SQL = """
    INSERT INTO messages (session_id, role, content, response_data)
    VALUES ($1, $2, $3, $4::jsonb)
"""
_GET_MESSAGES_SQL = """
    SELECT role, content, response_data, created_at
    FROM messages
    WHERE session_id = $1
    ORDER BY created_at ASC
    LIMIT $2 OFFSET $3
"""
_CURRENT_REVISION_SQL = """
    SELECT COALESCE(MAX(revision), 0) AS revision
    FROM turn_reservations
    WHERE session_id IS NOT DISTINCT FROM $1
"""
#: `updated_at = now()` is a deliberate side effect: logging in advances the
#: claimed session's liveness clock.
_ADOPT_OWNERSHIP_SQL = """
    UPDATE sessions SET user_id = $1, updated_at = now() WHERE user_id = $2
    RETURNING id
"""
#: Revision CAS (SESSION-2 #960): bumping each adopted revision makes
#: pre-adoption capabilities stale; `ON CONFLICT DO NOTHING` keeps it a no-op.
_BUMP_REVISION_SQL = """
    INSERT INTO turn_reservations (session_id, turn_key, payer, identity_id, revision, digest, status)
    SELECT $1, $2 || $1, 'anon', NULL, COALESCE(MAX(revision), 0) + 1, NULL, 'completed'
    FROM turn_reservations WHERE session_id = $1
    ON CONFLICT (session_id, revision) DO NOTHING
    RETURNING session_id
"""


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


def _as_text(value: object) -> str:
    return str(value) if isinstance(value, str) else ""


def _as_state(raw: object) -> dict[str, object] | None:
    if isinstance(raw, str):
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    if isinstance(raw, Mapping):
        return dict(raw)
    return None


def _message_row(row: Row) -> MessageRow:
    return MessageRow(
        role=_as_text(row["role"]),
        content=_as_text(row["content"]),
        response_data=row["response_data"],
        created_at=_as_text(row["created_at"]),
    )


class FinalSessionRepository:
    """The sole Session aggregate repository against the fresh-schema manifest."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def create(
        self, session_id: str, user_id: str, first_query: str, state: dict[str, object]
    ) -> None:
        await self._pool.execute(
            _CREATE_SESSION_SQL, session_id, user_id, first_query, json.dumps(state)
        )

    async def load(self, session_id: str) -> SessionRecord | None:
        row = await self._pool.fetchrow(_LOAD_SESSION_SQL, session_id)
        if row is None:
            return None
        return SessionRecord(
            session_id=_as_text(row["id"]),
            user_id=_as_text(row["user_id"]),
            title=_as_text(row["title"]) if row["title"] is not None else None,
            first_query=(
                _as_text(row["first_query"]) if row["first_query"] is not None else None
            ),
            state=_as_state(row["state"]),
            metadata=_as_state(row["metadata"]),
        )

    async def get_session_state(self, session_id: str) -> dict[str, object] | None:
        row = await self._pool.fetchrow(_LOAD_STATE_SQL, session_id)
        return _as_state(row["state"]) if row is not None else None

    async def upsert_session_state(
        self, session_id: str, state: dict[str, object]
    ) -> None:
        await self._pool.execute(
            _UPSERT_STATE_SQL, session_id, json.dumps(state, default=str)
        )

    async def delete_session_state(self, session_id: str) -> None:
        await self._pool.execute(_DELETE_SESSION_SQL, session_id)

    async def upsert_session(
        self,
        session_id: str,
        state: dict[str, object],
        metadata: dict[str, object] | None = None,
        *,
        user_id: str | None = None,
    ) -> None:
        await self._pool.execute(
            _UPSERT_SESSION_SQL,
            session_id,
            user_id,
            json.dumps(state),
            json.dumps(metadata or {}),
        )

    async def check_session_owner(self, session_id: str, user_id: str) -> bool:
        row = await self._pool.fetchrow(_CHECK_OWNER_SQL, session_id, user_id)
        return row is not None

    async def list_sessions(
        self,
        user_id: str,
        *,
        limit: int = 30,
    ) -> list[dict[str, object]]:
        rows = await self._pool.fetch(_LIST_SESSIONS_SQL, user_id, limit)
        return [dict(row) for row in rows]

    async def update_title(
        self,
        session_id: str,
        title: str,
        *,
        user_id: str | None = None,
    ) -> bool:
        if user_id is None:
            row = await self._pool.fetchrow(_UPDATE_TITLE_ANY_SQL, title, session_id)
        else:
            row = await self._pool.fetchrow(
                _UPDATE_TITLE_SQL, title, session_id, user_id
            )
        return row is not None

    async def insert_message(
        self,
        session_id: str,
        role: str,
        content: str,
        response_data: dict[str, object] | None = None,
    ) -> None:
        await self._pool.execute(
            _INSERT_MESSAGE_SQL,
            session_id,
            role,
            content,
            json.dumps(response_data) if response_data else None,
        )

    async def get_messages(
        self, session_id: str, *, limit: int = 100, offset: int = 0
    ) -> list[MessageRow]:
        rows = await self._pool.fetch(_GET_MESSAGES_SQL, session_id, limit, offset)
        return [_message_row(row) for row in rows]

    async def current_revision(self, session_id: str) -> int:
        """Return the session's current revision (max ever reserved; the client CAS token)."""
        row = await self._pool.fetchrow(_CURRENT_REVISION_SQL, session_id)
        return int(row["revision"]) if row is not None else 0

    async def history(
        self,
        session_id: str,
        user_id: str,
        *,
        limit: int,
        offset: int,
    ) -> HistoryPage | None:
        """One owned, ordered transcript page plus the revision; missing and forbidden collapse to None."""
        owner = await self._pool.fetchrow(_CHECK_OWNER_SQL, session_id, user_id)
        if owner is None:
            return None
        rows = await self._pool.fetch(_GET_MESSAGES_SQL, session_id, limit, offset)
        return HistoryPage(
            user_id=user_id,
            messages=[_message_row(row) for row in rows],
            revision=await self.current_revision(session_id),
        )

    async def adopt_ownership(
        self, from_anon_id: str, to_user_id: str
    ) -> AdoptionResult:
        """Adopt every anonymous-owned Session and bump its revision so
        pre-adoption capabilities go stale (one identity-dimensional UPDATE,
        transactional with the bumps, idempotent on a second run)."""
        async with self._pool.acquire() as connection:
            async with connection.transaction():
                adopted = await connection.fetch(
                    _ADOPT_OWNERSHIP_SQL, to_user_id, from_anon_id
                )
                bumped = 0
                for row in adopted:
                    bumped += int(await self._bump_revision(connection, row["id"]))
                return AdoptionResult(
                    adopted_count=len(adopted), revisions_bumped=bumped
                )

    async def _bump_revision(self, connection: PoolConnection, session_id: str) -> int:
        """Advance one adopted session's revision; 1 when the marker landed."""
        row = await connection.fetchrow(
            _BUMP_REVISION_SQL, session_id, ADOPT_TURN_KEY_PREFIX
        )
        return 1 if row is not None else 0
