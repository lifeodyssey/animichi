"""Session store implementations for infrastructure layer.

This module provides session store backends: in-memory for development
and Supabase-backed for production persistence.
Use the factory function to create the appropriate store based on configuration.
"""

from agent.infrastructure.session.base import SessionData, SessionStore
from agent.infrastructure.session.factory import create_session_store
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.infrastructure.session.supabase_session import SupabaseSessionStore

__all__ = [
    "SessionStore",
    "SessionData",
    "InMemorySessionStore",
    "SupabaseSessionStore",
    "create_session_store",
]
