#!/usr/bin/env python3
"""Purge stale anonymous sessions with no route output (issue #273 Task 3).

Anonymous conversations accumulate free-text queries and locations with no
TTL. A conversation is eligible once it has gone `anonymous_session_retention_
days` without an update AND is associated with no `routes` row — a session
that produced a route is retained permanently, unconditionally.

Usage:
    uv run python -m agent.scripts.purge_anonymous_sessions
    uv run python -m agent.scripts.purge_anonymous_sessions --dry-run
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


async def purge_anonymous_sessions(
    db: SupabaseClient,
    *,
    retention_days: int,
    now: datetime | None = None,
    dry_run: bool = False,
) -> int:
    """Sweep routeless anonymous sessions inactive since the cutoff.

    Per-session transaction: each purge deletes that session's conversation
    (cascading its messages) and its session row as one unit, so the
    `routes.session_id` FK backstop can only ever roll back one session, not
    the whole sweep.
    """
    cutoff = (now or datetime.now(UTC)) - timedelta(days=retention_days)
    session_ids = await db.session.find_purgeable_anonymous_sessions(cutoff)
    if dry_run:
        logger.info("anonymous_purge_dry_run", eligible=len(session_ids))
        return len(session_ids)
    for session_id in session_ids:
        await db.session.purge_session(session_id)
    logger.info("anonymous_sessions_purged", count=len(session_ids))
    return len(session_ids)


async def _main(dry_run: bool) -> None:
    settings = get_settings()
    dsn = settings.supabase_db_url
    if not dsn:
        logger.error("SUPABASE_DB_URL is not set")
        sys.exit(1)
    async with SupabaseClient(dsn) as db:
        await purge_anonymous_sessions(
            db,
            retention_days=settings.anonymous_session_retention_days,
            dry_run=dry_run,
        )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report eligible sessions without deleting",
    )
    return parser.parse_args()


if __name__ == "__main__":
    asyncio.run(_main(_parse_args().dry_run))
