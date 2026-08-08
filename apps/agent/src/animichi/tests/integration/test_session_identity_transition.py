"""Real-Postgres coverage for session identity transition + anonymous
retention (issue #273 Task 3). Uses testcontainer Postgres via `real_db`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from animichi.infrastructure.supabase.client import SupabaseClient
from animichi.scripts.purge_anonymous_sessions import purge_anonymous_sessions

# `animichi.tests.conftest_db` is already registered by the directory-level
# `tests/integration/conftest.py` (`pytest_plugins`) — redeclaring it here
# would be a no-op duplicate (review round 2 Sonar smell).


def _anon_id() -> str:
    return "anon_" + uuid.uuid4().hex


async def _seed_session(
    db: SupabaseClient, session_id: str, user_id: str, query: str = "hello"
) -> None:
    await db.session.create_owned_session(session_id, user_id, query, {"k": "v"})


async def _seed_saved_route(db: SupabaseClient, session_id: str) -> None:
    """Direct saved_routes insert — the agent no longer owns a routes writer
    (#852 P1 deleted RoutesRepository); retention still treats a session that
    produced a saved route as permanently retained."""
    await db.pool.execute(
        "INSERT INTO saved_routes (claim_session_id, point_ids) "
        "VALUES ($1, $2::text[])",
        session_id,
        ["pt-1"],
    )


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


@pytest.mark.integration
async def test_retention_purges_only_the_inactive_routeless_sibling(real_db) -> None:
    anon = _anon_id()
    stale = f"sess-{uuid.uuid4().hex}"
    fresh = f"sess-{uuid.uuid4().hex}"
    await _seed_session(real_db, stale, anon, "stale query")
    await _seed_session(real_db, fresh, anon, "fresh query")
    old_cutoff = _days_ago(40)
    await _backdate_conversation(real_db, stale, old_cutoff)

    report = await purge_anonymous_sessions(real_db, retention_days=30)

    assert report.purged == 1
    assert await real_db.session.get_conversation(stale) is None
    assert await real_db.session.get_conversation(fresh) is not None


@pytest.mark.integration
async def test_route_bearing_session_is_retained_permanently(real_db) -> None:
    anon = _anon_id()
    with_route = f"sess-{uuid.uuid4().hex}"
    without_route = f"sess-{uuid.uuid4().hex}"
    await _seed_session(real_db, with_route, anon, "routed query")
    await _seed_session(real_db, without_route, anon, "routeless query")
    await _seed_saved_route(real_db, with_route)
    old_cutoff = _days_ago(400)
    await _backdate_conversation(real_db, with_route, old_cutoff)
    await _backdate_conversation(real_db, without_route, old_cutoff)

    report = await purge_anonymous_sessions(real_db, retention_days=30)

    assert report.purged == 1
    assert await real_db.session.get_conversation(with_route) is not None
    assert await real_db.session.get_session(with_route) is not None
    assert await real_db.session.get_conversation(without_route) is None


@pytest.mark.integration
async def test_purge_deletes_conversations_before_sessions_leaving_no_orphans(
    real_db,
) -> None:
    anon = _anon_id()
    session_id = f"sess-{uuid.uuid4().hex}"
    await _seed_session(real_db, session_id, anon, "orphan check")
    await _backdate_conversation(real_db, session_id, _days_ago(40))

    report = await purge_anonymous_sessions(real_db, retention_days=30)

    assert report.purged == 1
    assert await real_db.session.get_conversation(session_id) is None
    assert await real_db.session.get_session(session_id) is None
    messages = await real_db.pool.fetch(
        "SELECT 1 FROM conversation_messages WHERE session_id = $1", session_id
    )
    assert messages == []


def _days_ago(days: int) -> datetime:
    return datetime.now(UTC) - timedelta(days=days)


async def _backdate_conversation(
    db: SupabaseClient, session_id: str, when: datetime
) -> None:
    await db.pool.execute(
        "UPDATE conversations SET updated_at = $1 WHERE session_id = $2",
        when,
        session_id,
    )
