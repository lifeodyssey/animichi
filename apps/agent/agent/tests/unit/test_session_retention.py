"""Unit tests for the retention query shape (issue #273 Task 3).

Behavioral proof that the exclusion predicate is selective (not a blanket
skip) and that real users are never touched lives in the Docker-backed
`tests/integration/test_session_identity_transition.py`. These tests pin the
generated SQL's structural contract with a mocked pool, so a later edit that
deletes the route-association `NOT EXISTS` clause or swaps the collation-
unsafe range scan back in fails immediately, without needing Postgres.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import asyncpg
import pytest

from agent.infrastructure.supabase.repositories.session import SessionRepository
from agent.scripts.purge_anonymous_sessions import purge_anonymous_sessions

CUTOFF = datetime(2026, 6, 28, tzinfo=UTC)


@pytest.fixture
def pool() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def repo(pool: AsyncMock) -> SessionRepository:
    return SessionRepository(pool)


async def test_find_purgeable_excludes_route_bearing_sessions_by_construction(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    """The exclusion pair: the predicate must carry a NOT EXISTS against
    routes, not a blanket "no filter at all" scan."""
    pool.fetch.return_value = []
    await repo.find_purgeable_anonymous_sessions(CUTOFF)
    sql = pool.fetch.await_args.args[0]
    assert "NOT EXISTS" in sql
    assert "routes r" in sql
    assert "r.session_id = c.session_id" in sql


async def test_find_purgeable_uses_collation_safe_like_not_a_range_scan(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    """Collation trap guard: an anon-prefix match must be an escaped LIKE
    (paired with the text_pattern_ops index), never a `>=`/`<` range scan."""
    pool.fetch.return_value = []
    await repo.find_purgeable_anonymous_sessions(CUTOFF)
    sql = pool.fetch.await_args.args[0]
    assert "LIKE 'anon\\_%' ESCAPE '\\'" in sql
    assert ">=" not in sql
    assert "<=" not in sql


async def test_find_purgeable_passes_cutoff_as_the_liveness_bound(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = []
    await repo.find_purgeable_anonymous_sessions(CUTOFF)
    sql, cutoff_arg = pool.fetch.await_args.args
    assert "c.updated_at < $1" in sql
    assert cutoff_arg == CUTOFF


async def test_find_purgeable_returns_session_ids_from_rows(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [{"session_id": "sess-a"}, {"session_id": "sess-b"}]
    result = await repo.find_purgeable_anonymous_sessions(CUTOFF)
    assert result == ["sess-a", "sess-b"]


async def test_purge_run_with_no_eligible_rows_deletes_nothing() -> None:
    db = AsyncMock()
    db.session.find_purgeable_anonymous_sessions = AsyncMock(return_value=[])
    db.session.purge_session = AsyncMock()
    purged = await purge_anonymous_sessions(db, retention_days=30, now=CUTOFF)
    assert purged == 0
    db.session.purge_session.assert_not_called()


async def test_purge_run_deletes_every_eligible_session_once() -> None:
    db = AsyncMock()
    db.session.find_purgeable_anonymous_sessions = AsyncMock(
        return_value=["sess-a", "sess-b"]
    )
    db.session.purge_session = AsyncMock()
    purged = await purge_anonymous_sessions(db, retention_days=30, now=CUTOFF)
    assert purged == 2
    assert db.session.purge_session.await_count == 2
    db.session.purge_session.assert_any_await("sess-a")
    db.session.purge_session.assert_any_await("sess-b")


async def test_dry_run_reports_without_deleting() -> None:
    db = AsyncMock()
    db.session.find_purgeable_anonymous_sessions = AsyncMock(return_value=["sess-a"])
    db.session.purge_session = AsyncMock()
    purged = await purge_anonymous_sessions(
        db, retention_days=30, now=CUTOFF, dry_run=True
    )
    assert purged == 1
    db.session.purge_session.assert_not_called()


async def test_one_session_fk_race_is_isolated_the_sweep_continues() -> None:
    """A concurrent-race FK backstop hit on one session must not abort the
    rest of the sweep — it is exactly the case the backstop exists to catch,
    not a reason to red the whole cron run."""
    db = AsyncMock()
    db.session.find_purgeable_anonymous_sessions = AsyncMock(
        return_value=["sess-a", "sess-race", "sess-b"]
    )

    async def _purge(session_id: str) -> None:
        if session_id == "sess-race":
            raise asyncpg.ForeignKeyViolationError("routes_session_id_fkey")

    db.session.purge_session = AsyncMock(side_effect=_purge)

    purged = await purge_anonymous_sessions(db, retention_days=30, now=CUTOFF)

    assert purged == 2
    assert db.session.purge_session.await_count == 3


async def test_a_non_postgres_error_is_not_swallowed_and_propagates() -> None:
    """An unexpected (non-database) failure is a programming bug, not a
    benign race — it must propagate so the CLI exits nonzero."""
    db = AsyncMock()
    db.session.find_purgeable_anonymous_sessions = AsyncMock(return_value=["sess-a"])
    db.session.purge_session = AsyncMock(side_effect=RuntimeError("boom"))

    with pytest.raises(RuntimeError, match="boom"):
        await purge_anonymous_sessions(db, retention_days=30, now=CUTOFF)
