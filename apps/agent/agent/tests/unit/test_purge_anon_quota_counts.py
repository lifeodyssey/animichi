"""Unit tests for the anon_daily_message_count retention CLI (issue #282 review)."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

from agent.scripts.purge_anon_quota_counts import purge_anon_quota_counts

NOW = datetime(2026, 7, 26, tzinfo=UTC)


def _db(*, removed: int = 0, eligible: int = 0) -> MagicMock:
    db = MagicMock()
    db.anon_quota.purge_older_than = AsyncMock(return_value=removed)
    db.pool.fetchval = AsyncMock(return_value=eligible)
    return db


async def test_purge_deletes_rows_older_than_the_retention_window() -> None:
    db = _db(removed=3)
    removed = await purge_anon_quota_counts(db, retention_days=30, now=NOW)
    assert removed == 3
    cutoff = db.anon_quota.purge_older_than.await_args.args[0]
    assert cutoff.isoformat() == "2026-06-26"


async def test_dry_run_reports_without_deleting() -> None:
    db = _db(eligible=7)
    removed = await purge_anon_quota_counts(
        db, retention_days=30, now=NOW, dry_run=True
    )
    assert removed == 7
    db.anon_quota.purge_older_than.assert_not_awaited()


async def test_dry_run_still_uses_the_same_cutoff_as_a_real_run() -> None:
    db = _db(eligible=0)
    await purge_anon_quota_counts(db, retention_days=30, now=NOW, dry_run=True)
    cutoff = db.pool.fetchval.await_args.args[1]
    assert cutoff.isoformat() == "2026-06-26"
