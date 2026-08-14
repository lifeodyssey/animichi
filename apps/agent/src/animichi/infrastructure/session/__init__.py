"""Session store implementations for infrastructure layer.

This module provides session store backends: in-memory for development and
the write-through cache over the SQLModel session repository for production
persistence (#994).
Use the factory function to create the appropriate store based on configuration.
"""

from animichi.infrastructure.session.base import SessionData, SessionStore
from animichi.infrastructure.session.cached_session_store import CachedSessionStore
from animichi.infrastructure.session.factory import create_session_store
from animichi.infrastructure.session.memory import InMemorySessionStore

__all__ = [
    "SessionStore",
    "SessionData",
    "InMemorySessionStore",
    "CachedSessionStore",
    "create_session_store",
]
