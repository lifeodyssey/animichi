"""Harness Memory store composition over the shared session factory (#995).

The harness ``Memory`` capability talks to a ``MemoryStore`` protocol; the
production adapter is :class:`SQLModelMemoryStore`, which implements that
protocol (plus bounded lexical search) with typed SQLModel/SQLAlchemy
statements against the Atlas-provisioned ``agent_memory`` tables — it never
accepts or executes an unchecked SQL string (raw-SQL policy, #999). This
module is the composition seam: it resolves the aggregate's session factory
and returns ``None`` for non-aggregate ``db`` objects (test doubles),
disabling Memory exactly as the asyncpg shim did.
"""

from __future__ import annotations

from pydantic_ai_harness.memory import MemoryStore

from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.infrastructure.persistence.repositories.memory import (
    SQLModelMemoryStore,
)


def postgres_memory_store(db: object) -> MemoryStore | None:
    """Build the harness memory store over the aggregate's factory, or ``None``.

    The session factory is the lifespan-owned one (resolved from the
    aggregate); the store never owns or closes it. Test doubles and other
    ``db`` objects resolve to ``None``, disabling Memory.
    """
    if not isinstance(db, PersistenceRepos):
        return None
    return SQLModelMemoryStore(db.sessionmaker)
