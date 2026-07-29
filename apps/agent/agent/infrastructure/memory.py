"""Official harness Memory store composition over the shared database pool."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from typing import cast

from pydantic_ai_harness.memory import PostgresConnection, PostgresMemoryStore

from agent.infrastructure.supabase.client import SupabaseClient
from agent.infrastructure.supabase.client_types import AsyncPGPool


class AsyncpgMemoryPool:
    """Present asyncpg's overloads as the harness's narrow pool protocol."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    def acquire(self) -> AbstractAsyncContextManager[PostgresConnection]:
        return cast(
            AbstractAsyncContextManager[PostgresConnection], self._pool.acquire()
        )


def postgres_memory_store(db: object) -> PostgresMemoryStore | None:
    """Reuse a connected SupabaseClient pool without owning its lifecycle."""
    if not isinstance(db, SupabaseClient):
        return None
    return PostgresMemoryStore(AsyncpgMemoryPool(db.pool))
