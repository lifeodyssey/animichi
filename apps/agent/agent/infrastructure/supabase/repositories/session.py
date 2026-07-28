"""Session and conversation operations."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from datetime import datetime

from agent.infrastructure.supabase.client_types import AsyncPGPool, Row

_COMMAND_TAG_ROW_COUNT = re.compile(r"(\d+)\s*$")

_CREATE_SESSION_SQL = """
    INSERT INTO sessions (id, state, metadata) VALUES ($1, $2::jsonb, '{}'::jsonb)
"""
_CREATE_CONVERSATION_SQL = """
    INSERT INTO conversations (session_id, user_id, first_query) VALUES ($1, $2, $3)
"""
#: `updated_at = now()` is a deliberate side effect, not an incidental touch:
#: logging in is itself activity, so a session that was already near the
#: retention cutoff gets a fresh liveness clock instead of being purged out
#: from under a user who just claimed it. It never *shortens* the window —
#: only a real anon-owned row can match the WHERE clause at all.
_MIGRATE_OWNERSHIP_SQL = """
    UPDATE conversations SET user_id = $1, updated_at = now() WHERE user_id = $2
"""
#: Anonymous identities always carry the `anon_` prefix (worker/auth.ts); the
#: escaped LIKE — not a `>=`/`<` range predicate — is the collation-safe match
#: this partial scan relies on (paired with the `text_pattern_ops` index).
_FIND_PURGEABLE_SQL = """
    SELECT c.session_id
    FROM conversations c
    WHERE c.user_id LIKE 'anon\\_%' ESCAPE '\\'
      AND c.updated_at < $1
      AND NOT EXISTS (SELECT 1 FROM routes r WHERE r.session_id = c.session_id)
"""


def _rows_affected(status: str) -> int:
    """Parse asyncpg's command-tag status string (e.g. ``"UPDATE 3"``).

    Falls back to 0 for a tag with no trailing row count (there is no such
    case for ``UPDATE``/``DELETE`` in practice, but this must never raise —
    a parse failure here would turn a successful mutation into a 500).
    """
    match = _COMMAND_TAG_ROW_COUNT.search(status)
    return int(match.group(1)) if match else 0


class SessionRepository:
    """Session and conversation data access."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def create_owned_session(
        self, session_id: str, user_id: str, first_query: str, state: dict[str, object]
    ) -> None:
        """Atomically create server session state and its ownership row."""
        async with self._pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    _CREATE_SESSION_SQL, session_id, json.dumps(state)
                )
                await connection.execute(
                    _CREATE_CONVERSATION_SQL, session_id, user_id, first_query
                )

    async def get_session(self, session_id: str) -> Row | None:
        """Fetch a session by ID."""
        return await self._pool.fetchrow(
            "SELECT * FROM sessions WHERE id = $1", session_id
        )

    async def upsert_session(
        self,
        session_id: str,
        state: dict[str, object],
        metadata: dict[str, object] | None = None,
    ) -> None:
        """Create or update a session."""
        await self._pool.execute(
            """
            INSERT INTO sessions (id, state, metadata) VALUES ($1, $2::jsonb, $3::jsonb)
            ON CONFLICT (id) DO UPDATE SET state = $2::jsonb, metadata = COALESCE($3::jsonb, sessions.metadata)
            """,
            session_id,
            json.dumps(state),
            json.dumps(metadata or {}),
        )

    async def upsert_conversation(
        self,
        session_id: str,
        user_id: str,
        first_query: str,
    ) -> None:
        """Create a conversation row or touch its updated timestamp."""
        await self._pool.execute(
            """
            INSERT INTO conversations (session_id, user_id, first_query)
            VALUES ($1, $2, $3)
            ON CONFLICT (session_id) DO UPDATE SET
                updated_at = now()
            """,
            session_id,
            user_id,
            first_query,
        )

    async def update_conversation_title(
        self,
        session_id: str,
        title: str,
        *,
        user_id: str | None = None,
    ) -> None:
        """Set the generated or user-supplied title for a conversation."""
        if user_id is None:
            await self._pool.execute(
                """
                UPDATE conversations
                SET title = $1, updated_at = now()
                WHERE session_id = $2
                """,
                title,
                session_id,
            )
            return

        await self._pool.execute(
            """
            UPDATE conversations
            SET title = $1, updated_at = now()
            WHERE session_id = $2 AND user_id = $3
            """,
            title,
            session_id,
            user_id,
        )

    async def get_conversations(
        self,
        user_id: str,
        *,
        limit: int = 30,
    ) -> list[dict[str, object]]:
        """Return a user's conversations, most recent first."""
        rows = await self._pool.fetch(
            """
            SELECT session_id, title, first_query, created_at, updated_at
            FROM conversations
            WHERE user_id = $1
            ORDER BY updated_at DESC
            LIMIT $2
            """,
            user_id,
            limit,
        )
        return [dict(row) for row in rows]

    async def get_conversation(self, session_id: str) -> dict[str, object] | None:
        """Fetch a single conversation by session_id."""
        row = await self._pool.fetchrow(
            "SELECT session_id, user_id, title, first_query, created_at, updated_at FROM conversations WHERE session_id = $1",
            session_id,
        )
        return dict(row) if row else None

    async def upsert_session_state(
        self, session_id: str, state: dict[str, object]
    ) -> None:
        """Persist session state as JSONB."""
        await self._pool.execute(
            """INSERT INTO sessions (id, state, updated_at)
               VALUES ($1, $2::jsonb, now())
               ON CONFLICT (id)
               DO UPDATE SET state = $2::jsonb, updated_at = now()""",
            session_id,
            json.dumps(state, default=str),
        )

    async def get_session_state(self, session_id: str) -> dict[str, object] | None:
        """Load session state."""
        row = await self._pool.fetchrow(
            "SELECT state FROM sessions WHERE id = $1",
            session_id,
        )
        if not (row and row["state"]):
            return None
        raw = row["state"]
        if isinstance(raw, str):
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else None
        if isinstance(raw, Mapping):
            return dict(raw)
        return None

    async def check_session_owner(self, session_id: str, user_id: str) -> bool:
        """Return True if the conversation belongs to the given user."""
        row = await self._pool.fetchrow(
            "SELECT 1 FROM conversations WHERE session_id = $1 AND user_id = $2",
            session_id,
            user_id,
        )
        return row is not None

    async def delete_session_state(self, session_id: str) -> None:
        """Delete session state by session ID."""
        await self._pool.execute("DELETE FROM sessions WHERE id = $1", session_id)

    async def migrate_ownership(self, from_anon_id: str, to_user_id: str) -> bool:
        """Re-point every conversation owned by an anonymous identity to the
        real user in a single identity-dimensional UPDATE (not INSERT — this
        never creates a conversation). Idempotent: a second run matches zero
        rows. Returns True iff at least one row changed."""
        status = await self._pool.execute(
            _MIGRATE_OWNERSHIP_SQL, to_user_id, from_anon_id
        )
        return _rows_affected(status) > 0

    async def find_purgeable_anonymous_sessions(self, cutoff: datetime) -> list[str]:
        """Session ids of anonymous, routeless conversations inactive since
        cutoff. `updated_at` is read as liveness, not creation age."""
        rows = await self._pool.fetch(_FIND_PURGEABLE_SQL, cutoff)
        return [str(row["session_id"]) for row in rows]

    async def purge_session(self, session_id: str) -> None:
        """Delete one session's conversation (cascading its messages) and its
        session row, in a single transaction per session. Ordering matters:
        conversations first, sessions last — the `routes.session_id` FK is
        the transactional backstop if the exclusion predicate is ever wrong,
        and it can only fire on the sessions delete, rolling the whole unit
        back rather than half-destroying a route-bearing session."""
        async with self._pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    "DELETE FROM conversations WHERE session_id = $1", session_id
                )
                await connection.execute(
                    "DELETE FROM sessions WHERE id = $1", session_id
                )
