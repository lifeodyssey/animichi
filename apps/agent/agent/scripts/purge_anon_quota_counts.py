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
import sys
from datetime import UTC, datetime, timedelta

from agent.config.settings import get_settings
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


async def _main(dry_run: bool) -> None:
    settings = get_settings()
    dsn = settings.supabase_db_url
    if not dsn:
        logger.error("SUPABASE_DB_URL is not set")
        sys.exit(1)
    async with SupabaseClient(dsn) as db:
        await purge_anon_quota_counts(
            db,
            retention_days=settings.anon_daily_message_count_retention_days,
            dry_run=dry_run,
        )


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
