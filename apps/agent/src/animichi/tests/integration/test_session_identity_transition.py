"""Real-Postgres coverage for session identity transition (issue #273 Task 3).
Uses testcontainer Postgres via `real_db`.
"""

from __future__ import annotations

import uuid

import pytest

from animichi.infrastructure.supabase.client import SupabaseClient

# `animichi.tests.conftest_db` is already registered by the directory-level
# `tests/integration/conftest.py` (`pytest_plugins`) — redeclaring it here
# would be a no-op duplicate (review round 2 Sonar smell).


def _anon_id() -> str:
    return "anon_" + uuid.uuid4().hex


async def _seed_session(
    db: SupabaseClient, session_id: str, user_id: str, query: str = "hello"
) -> None:
    await db.session.create_owned_session(session_id, user_id, query, {"k": "v"})


@pytest.mark.integration
async def test_migration_moves_ownership_and_preserves_content(real_db) -> None:
    """Reading state AND message history after the transition must match the
    pre-login read exactly — the migration re-points ownership only."""
    anon = _anon_id()
    session_id = f"sess-{uuid.uuid4().hex}"
    await _seed_session(real_db, session_id, anon, "君の名はの聖地は？")
    await real_db.messages.insert_message(session_id, "user", "君の名はの聖地は？")
    await real_db.messages.insert_message(
        session_id, "assistant", "3件見つかりました。"
    )
    messages_before = await real_db.messages.get_messages(session_id)

    changed = await real_db.session.migrate_ownership(anon, "real-user-1")
    assert changed is True

    conversation = await real_db.session.get_conversation(session_id)
    assert conversation is not None
    assert conversation["user_id"] == "real-user-1"
    state = await real_db.session.get_session_state(session_id)
    assert state == {"k": "v"}
    messages_after = await real_db.messages.get_messages(session_id)
    assert messages_after == messages_before
    assert len(messages_after) == 2


@pytest.mark.integration
async def test_migration_moves_every_session_for_the_same_anon_identity(
    real_db,
) -> None:
    anon = _anon_id()
    session_a = f"sess-{uuid.uuid4().hex}"
    session_b = f"sess-{uuid.uuid4().hex}"
    await _seed_session(real_db, session_a, anon, "query a")
    await _seed_session(real_db, session_b, anon, "query b")

    changed = await real_db.session.migrate_ownership(anon, "real-user-2")
    assert changed is True

    conv_a = await real_db.session.get_conversation(session_a)
    conv_b = await real_db.session.get_conversation(session_b)
    assert conv_a["user_id"] == "real-user-2"
    assert conv_b["user_id"] == "real-user-2"


@pytest.mark.integration
async def test_original_anon_identity_loses_ownership_after_transition(
    real_db,
) -> None:
    anon = _anon_id()
    session_id = f"sess-{uuid.uuid4().hex}"
    await _seed_session(real_db, session_id, anon, "query")

    await real_db.session.migrate_ownership(anon, "real-user-3")

    assert await real_db.session.check_session_owner(session_id, anon) is False
    assert await real_db.session.check_session_owner(session_id, "real-user-3") is True
