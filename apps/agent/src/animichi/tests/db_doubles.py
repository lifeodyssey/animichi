"""Shared Supabase-client test doubles."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from animichi.infrastructure.supabase.client import SupabaseClient


def build_persistence_supabase_double() -> MagicMock:
    """Build a Supabase double with RuntimeAPI persistence sinks wired.

    Wires only the shared persistence writes; callers set their own read doubles.
    SESSION-3 (#961): the transcript port resolves from the sole Session
    repository, so the message insert lives on ``db.session``.
    """
    db = MagicMock(spec=SupabaseClient)
    db.session.create = AsyncMock()
    db.session.upsert_session = AsyncMock()
    db.session.insert_message = AsyncMock()
    # #663: the real repos are nested (db.session / db.feedback), not flat
    # db.insert_message / db.insert_request_log — that flat shape was the
    # production bug. Wired here so every double built off this helper
    # matches SupabaseClient's real structure.
    db.feedback.insert_request_log = AsyncMock()
    db.pool.fetch = AsyncMock(return_value=[])
    return db
