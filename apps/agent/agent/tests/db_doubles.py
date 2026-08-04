"""Shared Supabase-client test doubles."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from agent.infrastructure.supabase.client import SupabaseClient


def build_persistence_supabase_double() -> MagicMock:
    """Build a Supabase double with RuntimeAPI persistence sinks wired.

    Wires only the shared persistence writes; callers set their own read doubles.
    """
    db = MagicMock(spec=SupabaseClient)
    db.session.create_owned_session = AsyncMock()
    db.session.upsert_session = AsyncMock()
    db.session.upsert_conversation = AsyncMock()
    db.session.update_conversation_title = AsyncMock()
    db.routes.save_route = AsyncMock(return_value="route-1")
    # #663: the real repos are nested (db.messages / db.feedback), not flat
    # db.insert_message / db.insert_request_log — that flat shape was the
    # production bug. Wired here so every double built off this helper
    # matches SupabaseClient's real structure.
    db.messages.insert_message = AsyncMock()
    db.feedback.insert_request_log = AsyncMock()
    db.pool.fetch = AsyncMock(return_value=[])
    return db
