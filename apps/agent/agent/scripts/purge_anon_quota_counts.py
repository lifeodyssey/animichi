#!/usr/bin/env python3
"""Purge stale anon_daily_message_count rows (issue #282 review, retention).

`anon_daily_message_count` is a pure per-day aggregate counter with no
dependent rows (unlike anonymous sessions), so its retention policy is a
single age-based DELETE — no FK backstop or per-row transaction is needed.

Usage:
    uv run python -m agent.scripts.purge_anon_quota_counts
    uv run python -m agent.scripts.purge_anon_quota_counts --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

from agent.config.cron_settings import get_purge_cron_settings
from agent.infrastructure.supabase.client import SupabaseClient
from agent.utils.logger import get_logger

logger = get_logger(__name__)


async def purge_anon_quota_counts(
    db: SupabaseClient,
    *,
    retention_days: int,
    now: datetime | None = None,
    dry_run: bool = False,
) -> int:
    """Delete `anon_daily_message_count` rows older than the retention cutoff."""
    cutoff = ((now or datetime.now(UTC)) - timedelta(days=retention_days)).date()
    if dry_run:
        eligible = await db.pool.fetchval(
            "SELECT count(*) FROM anon_daily_message_count WHERE usage_date < $1",
            cutoff,
        )
        logger.info("anon_quota_counts_purge_dry_run", eligible=eligible)
        return int(eligible or 0)
    removed = await db.anon_quota.purge_older_than(cutoff)
    logger.info("anon_quota_counts_purged", count=removed)
    return removed


def _write_step_summary(*, count: int, dry_run: bool) -> None:
    """Best-effort: record the row count where the workflow's job summary
    can show it, if running under GitHub Actions."""
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    label = "eligible" if dry_run else "removed"
    _append_step_summary(
        Path(summary_path), f"anon-quota-count purge: {label}={count}\n"
    )


def _append_step_summary(path: Path, line: str) -> None:
    try:
        with path.open("a", encoding="utf-8") as summary:
            summary.write(line)
    except OSError as exc:
        logger.warning(
            "anon_quota_step_summary_write_failed", error_type=type(exc).__name__
        )


async def _main(dry_run: bool) -> None:
    # DB-only cron (issue #508): this is `PurgeCronSettings`, not the main
    # service's `Settings` — it never resolves a model credential, and its
    # own validator already guarantees `supabase_db_url` is non-empty here.
    settings = get_purge_cron_settings()
    async with SupabaseClient(settings.supabase_db_url) as db:
        count = await purge_anon_quota_counts(
            db,
            retention_days=settings.anon_daily_message_count_retention_days,
            dry_run=dry_run,
        )
    _write_step_summary(count=count, dry_run=dry_run)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report eligible rows without deleting",
    )
    return parser.parse_args()


if __name__ == "__main__":
    asyncio.run(_main(_parse_args().dry_run))
