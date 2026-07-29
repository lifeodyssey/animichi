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
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import asyncpg

from agent.config.cron_settings import get_purge_cron_settings
from agent.infrastructure.supabase.client import SupabaseClient
from agent.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class PurgeReport:
    """Outcome of one sweep. `raced` is the find-then-delete race being
    caught structurally (a session whose owner logged in mid-sweep) — a
    normal outcome, not a failure. `failed` is a per-session database error
    (e.g. the FK backstop firing) that was isolated and logged."""

    purged: int
    raced: int
    failed: int


#: A single session's purge can lose a benign race — another request wrote a
#: route between the eligibility scan and this delete, so the FK backstop
#: fires for that one row. That is exactly the case the backstop exists to
#: catch, not a reason to abort the sweep: everything asyncpg raises for a
#: real database-level failure (including the FK violation) derives from
#: this. A non-Postgres exception (a programming bug) is deliberately NOT
#: caught here — it propagates out of the sweep and crashes the CLI with a
#: nonzero exit, which is what should page someone.
_EXPECTED_PER_SESSION_ERRORS = asyncpg.PostgresError


async def purge_anonymous_sessions(
    db: SupabaseClient,
    *,
    retention_days: int,
    now: datetime | None = None,
    dry_run: bool = False,
) -> PurgeReport:
    """Sweep routeless anonymous sessions inactive since the cutoff.

    Per-session transaction AND per-session error isolation: each purge
    deletes that session's conversation (cascading its messages) and its
    session row as one unit. A session raced away by a concurrent login
    (`raced`) or refused by the FK backstop (`failed`) is logged and skipped
    rather than aborting the rest of the sweep.
    """
    cutoff = (now or datetime.now(UTC)) - timedelta(days=retention_days)
    session_ids = await db.session.find_purgeable_anonymous_sessions(cutoff)
    if dry_run:
        logger.info("anonymous_purge_dry_run", eligible=len(session_ids))
        return PurgeReport(purged=len(session_ids), raced=0, failed=0)
    report = await _purge_each(db, session_ids, cutoff)
    logger.info(
        "anonymous_sessions_purged",
        count=report.purged,
        raced=report.raced,
        failed=report.failed,
    )
    return report


async def _purge_each(
    db: SupabaseClient, session_ids: list[str], cutoff: datetime
) -> PurgeReport:
    purged = 0
    raced = 0
    failed = 0
    for session_id in session_ids:
        try:
            if await db.session.purge_session(session_id, cutoff):
                purged += 1
            else:
                raced += 1
        except _EXPECTED_PER_SESSION_ERRORS:
            failed += 1
            logger.warning(
                "anonymous_session_purge_failed", session_id=session_id, exc_info=True
            )
    return PurgeReport(purged=purged, raced=raced, failed=failed)


def _write_step_summary(report: PurgeReport) -> None:
    """Best-effort: record purged/raced/failed where the workflow's job
    summary can show it, if running under GitHub Actions."""
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    line = (
        f"anonymous-session purge: purged={report.purged} "
        f"raced={report.raced} failed={report.failed}\n"
    )
    Path(summary_path).open("a", encoding="utf-8").write(line)


async def _main(dry_run: bool) -> None:
    # DB-only cron (issue #508): this is `PurgeCronSettings`, not the main
    # service's `Settings` — it never resolves a model credential, and its
    # own validator already guarantees `supabase_db_url` is non-empty here.
    settings = get_purge_cron_settings()
    async with SupabaseClient(settings.supabase_db_url) as db:
        report = await purge_anonymous_sessions(
            db,
            retention_days=settings.anonymous_session_retention_days,
            dry_run=dry_run,
        )
    _write_step_summary(report)


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
