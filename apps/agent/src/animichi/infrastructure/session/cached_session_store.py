"""Database-backed session store with LRU write-through cache.

Implements the SessionStore protocol, persisting state through any adapter
that provides the three state methods (``get_session_state``,
``upsert_session_state``, ``delete_session_state``) while keeping an
in-memory cache to avoid repeated DB reads for active sessions (#994: the
adapter is the SQLModel session repository on the migrated path).
"""

from __future__ import annotations

from typing import Protocol

from animichi.domain.repo_types import SessionStateData
from animichi.utils.logger import get_logger

logger = get_logger(__name__)


class SessionStateStore(Protocol):
    """The three state-envelope operations the cache needs from a repository."""

    async def get_session_state(self, session_id: str) -> SessionStateData | None: ...

    async def upsert_session_state(
        self, session_id: str, state: SessionStateData
    ) -> None: ...

    async def delete_session_state(self, session_id: str) -> None: ...


class CachedSessionStore:
    """Persists session state with an in-memory FIFO cache.

    Write-through: every ``set`` writes to both the cache and the database.
    Reads check the cache first, falling back to the database on miss.
    """

    def __init__(self, store: SessionStateStore, cache_size: int = 256) -> None:
        self._store = store
        self._cache: dict[str, SessionStateData] = {}
        self._cache_size = cache_size

    async def get(self, session_id: str) -> SessionStateData | None:
        """Retrieve session state, checking cache first."""
        if session_id in self._cache:
            logger.debug("session_cache_hit", session_id=session_id)
            return self._cache[session_id]

        state = await self._store.get_session_state(session_id)
        if state is not None:
            self._evict_if_full()
            self._cache[session_id] = state
            logger.debug("session_cache_miss_loaded", session_id=session_id)
        return state

    async def set(self, session_id: str, state: SessionStateData) -> None:
        """Write-through: update cache and persist to DB."""
        self._evict_if_full()
        self._cache[session_id] = state
        await self._store.upsert_session_state(session_id, state)
        logger.debug("session_persisted", session_id=session_id)

    async def delete(self, session_id: str) -> None:
        """Remove session from cache and DB."""
        self._cache.pop(session_id, None)
        await self._store.delete_session_state(session_id)
        logger.debug("session_deleted", session_id=session_id)

    def _evict_if_full(self) -> None:
        """Evict oldest entries (FIFO) when cache is at capacity."""
        while len(self._cache) >= self._cache_size:
            oldest = next(iter(self._cache))
            del self._cache[oldest]
