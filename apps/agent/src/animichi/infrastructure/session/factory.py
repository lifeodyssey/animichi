"""Factory function for session store creation.

Provides a unified way to create session stores based on configuration.
Returns CachedSessionStore when a state store is provided, otherwise
falls back to InMemorySessionStore.
"""

from __future__ import annotations

from animichi.infrastructure.session.base import SessionStore
from animichi.infrastructure.session.cached_session_store import SessionStateStore
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.utils.logger import get_logger

logger = get_logger(__name__)


def create_session_store(
    db: SessionStateStore | None = None,
) -> SessionStore:
    """Create a session store.

    If a state store is provided, returns a CachedSessionStore that
    persists state across container restarts. Otherwise returns the
    in-memory store suitable for local development.
    """
    if db is not None:
        from animichi.infrastructure.session.cached_session_store import (
            CachedSessionStore,
        )

        logger.info("Creating database-backed session store")
        return CachedSessionStore(db)

    logger.info("Creating in-memory session store")
    return InMemorySessionStore()
