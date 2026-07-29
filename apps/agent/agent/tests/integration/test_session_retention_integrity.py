"""Real-Postgres coverage for the retention sweep's structural safety nets
(issue #273 Task 3, review round 2). Complements
`test_session_identity_transition.py`: this file proves the things a
mocked-pool unit test cannot — that a real user's row survives the sweep
(not just "the SQL string mentions a prefix check"), that the DELETE closes
the find-then-delete race against a real concurrent write, and that the
purge predicate actually uses the `text_pattern_ops` index rather than a
sequential scan.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from agent.infrastructure.supabase.client import SupabaseClient
from agent.infrastructure.supabase.repositories.session import _FIND_PURGEABLE_SQL
from agent.scripts.purge_anonymous_sessions import purge_anonymous_sessions

# `agent.tests.conftest_db` is already registered by the directory-level
# `tests/integration/conftest.py` (`pytest_plugins`) — redeclaring it here
# would be a no-op duplicate (review round 2 Sonar smell).


def _anon_id() -> str:
    return "anon_" + uuid.uuid4().hex


def _days_ago(days: int) -> datetime:
    return datetime.now(UTC) - timedelta(days=days)


async def _seed_session(db: SupabaseClient, session_id: str, user_id: str) -> None:
    await db.session.create_owned_session(session_id, user_id, "hello", {})


async def _backdate(db: SupabaseClient, session_id: str, when: datetime) -> None:
    await db.pool.execute(
        "UPDATE conversations SET updated_at = $1 WHERE session_id = $2",
        when,
        session_id,
    )


@pytest.mark.integration
async def test_a_real_logged_in_user_row_survives_regardless_of_age(real_db) -> None:
    """Real behavioral proof, not a SQL-text assertion: a genuinely present
    real-user conversation, 400 days stale, must never be swept — widening
    the anon-prefix LIKE would make this go red."""
    real_user_session = f"sess-{uuid.uuid4().hex}"
    await _seed_session(real_db, real_user_session, "real-user-survivor")
    await _backdate(real_db, real_user_session, _days_ago(400))

    report = await purge_anonymous_sessions(real_db, retention_days=30)

    assert report.purged == 0
    assert await real_db.session.get_conversation(real_user_session) is not None


@pytest.mark.integration
async def test_purge_session_race_a_concurrent_login_saves_the_session(
    real_db,
) -> None:
    """A real find-then-delete race: the eligibility scan runs, then the
    owner logs in (migrate_ownership) before the delete executes. The
    DELETE's own re-asserted predicate must find zero rows and leave the
    session untouched — not rely on the caller's stale candidate list."""
    anon = _anon_id()
    session_id = f"sess-{uuid.uuid4().hex}"
    await _seed_session(real_db, session_id, anon)
    cutoff = _days_ago(30)
    await _backdate(real_db, session_id, _days_ago(40))

    candidates = await real_db.session.find_purgeable_anonymous_sessions(cutoff)
    assert session_id in candidates

    # The race: the owner logs in between the scan above and the delete below.
    await real_db.session.migrate_ownership(anon, "real-user-race")

    purged = await real_db.session.purge_session(session_id, cutoff)

    assert purged is False
    assert await real_db.session.get_conversation(session_id) is not None
    assert await real_db.session.get_session(session_id) is not None


#: The purge sweep's own test images/Neon branches are provisioned as
#: en_US.utf8 (documented in docs/ops/anonymous-session-purge.md) — a
#: non-C collation, which is exactly the condition under which a plain
#: btree cannot service a LIKE prefix match and text_pattern_ops matters.
_EXPECTED_COLLATION = "en_US.utf8"


@pytest.mark.integration
async def test_purge_predicate_hits_the_pattern_ops_index_not_a_seq_scan(
    real_db,
) -> None:
    """Index/collation integrity (rev6 P1-1). Under the documented non-C
    collation, a plain btree on `user_id` cannot service a LIKE prefix
    match at all — only `text_pattern_ops` can.

    Mutation-direction verified locally: reverting the index to default ops
    (drop + recreate without `text_pattern_ops`) makes THIS test fail while
    `test_retention_purges_only_the_inactive_routeless_sibling` (the
    behavioral happy path) keeps passing. Two independent assertions catch
    it: the opclass check (structural) and the pattern-operator check
    (behavioral) — a bare "no Seq Scan" assertion would be a tautology
    under `enable_seqscan = off` (any btree scan, pattern-capable or not,
    satisfies it), so this pins the actual pattern range-scan operators
    (`~>=~` / `~<~`) that only appear in the plan when a pattern opclass
    index services the LIKE prefix."""
    async with real_db.pool.acquire() as connection:
        collation = await connection.fetchval(
            "SELECT datcollate FROM pg_database WHERE datname = current_database()"
        )
        assert collation == _EXPECTED_COLLATION
        index_def = await connection.fetchval(
            "SELECT indexdef FROM pg_indexes "
            "WHERE indexname = 'idx_conversations_user_id_pattern'"
        )
        assert index_def is not None
        assert "text_pattern_ops" in index_def

        await connection.execute("SET enable_seqscan = off")
        try:
            plan_rows = await connection.fetch(
                f"EXPLAIN {_FIND_PURGEABLE_SQL}", _days_ago(0)
            )
        finally:
            await connection.execute("SET enable_seqscan = on")
    plan_text = "\n".join(row["QUERY PLAN"] for row in plan_rows)
    assert "~>=~" in plan_text
    assert "~<~" in plan_text
