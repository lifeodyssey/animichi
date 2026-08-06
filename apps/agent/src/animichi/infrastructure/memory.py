"""Official harness Memory store composition over the shared database pool."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from typing import cast

from pydantic_ai_harness.memory import PostgresConnection, PostgresMemoryStore

from animichi.infrastructure.supabase.client import SupabaseClient


class AsyncpgMemoryPool:
    """Present asyncpg's overloads as the harness's narrow pool protocol."""

    def __init__(self, db: SupabaseClient) -> None:
        self._db = db

    def acquire(self) -> AbstractAsyncContextManager[PostgresConnection]:
        return cast(
            AbstractAsyncContextManager[PostgresConnection],
            self._db.pool.acquire(),
        )


def postgres_memory_store(db: object) -> PostgresMemoryStore | None:
    """Reuse a SupabaseClient pool without owning its lifecycle.

    The pool is resolved on first acquire, not at construction (issue #694):
    the lifespan may build the store before ``connect()`` has run.
    """
    if not isinstance(db, SupabaseClient):
        return None
    return PostgresMemoryStore(AsyncpgMemoryPool(db))
