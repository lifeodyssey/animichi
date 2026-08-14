"""Shared bounded and concurrent sweep contract for both ORM candidates."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from animichi.tests.integration.orm_bakeoff._contract_helpers import (
    cleanup,
    count_active_rows,
    insert_row,
    session_id,
    turn_key,
)
from animichi.tests.integration.orm_bakeoff.protocol import BakeoffTurnStore

pytestmark = pytest.mark.integration
PAST = datetime.now(UTC) - timedelta(seconds=30)


async def _seed_expired(pool: asyncpg.Pool, reserved: int, running: int) -> list[str]:
    session_ids: list[str] = []
    for status, count in (("reserved", reserved), ("running", running)):
        for index in range(count):
            sid = session_id("sweep")
            session_ids.append(sid)
            await insert_row(
                pool,
                session_id=sid,
                turn_key=turn_key("sweep"),
                revision=index + 1,
                status=status,
                lease_expires_at=PAST - timedelta(seconds=index),
            )
    return session_ids


async def test_sweep_claims_expired_rows_in_bounded_batches(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    session_ids = await _seed_expired(db_pool, reserved=4, running=2)
    try:
        first = await candidate_store.sweep(
            now=datetime.now(UTC), owner="sweep-1", batch_size=3, lease_seconds=30
        )
        assert first.released + first.failed == 3
        assert await count_active_rows(db_pool, session_ids) == 3
        second = await candidate_store.sweep(
            now=datetime.now(UTC), owner="sweep-1", batch_size=3, lease_seconds=30
        )
        assert first.released + second.released == 4
        assert first.failed + second.failed == 2
        assert await count_active_rows(db_pool, session_ids) == 0
    finally:
        await cleanup(db_pool, session_ids)


async def test_concurrent_sweeps_never_double_process(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    session_ids = await _seed_expired(db_pool, reserved=3, running=3)
    try:
        reports = await asyncio.gather(
            candidate_store.sweep(
                now=datetime.now(UTC), owner="sweep-a", batch_size=6, lease_seconds=30
            ),
            candidate_store.sweep(
                now=datetime.now(UTC), owner="sweep-b", batch_size=6, lease_seconds=30
            ),
        )
        assert sum(report.released for report in reports) == 3
        assert sum(report.failed for report in reports) == 3
        assert await count_active_rows(db_pool, session_ids) == 0
    finally:
        await cleanup(db_pool, session_ids)
