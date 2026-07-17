"""Shared Supabase-client test doubles."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from agent.infrastructure.supabase.client import SupabaseClient


def build_persistence_supabase_double() -> MagicMock:
    """Build a Supabase double with RuntimeAPI persistence sinks wired.

    Wires only the shared persistence writes; callers set their own read doubles.
    """
    db = MagicMock(spec=SupabaseClient)
    db.session.upsert_session = AsyncMock()
    db.session.upsert_conversation = AsyncMock()
    db.session.update_conversation_title = AsyncMock()
    db.routes.save_route = AsyncMock(return_value="route-1")
    db.pool.fetch = AsyncMock(return_value=[])
    return db
