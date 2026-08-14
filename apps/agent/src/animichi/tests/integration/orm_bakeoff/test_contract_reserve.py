"""Contract gates for the reservation path, parametrized over both candidates.

Every test here runs once per ORM candidate against the same migrated
PostgreSQL, the same seeded rows, and the same clock values, so assertions
cannot drift between implementations.
"""

from __future__ import annotations

import asyncio

import asyncpg
import pytest

from animichi.tests.integration.orm_bakeoff._contract_helpers import (
    cleanup,
    count_rows,
    insert_row,
    reserve_request,
    session_id,
    turn_key,
)
from animichi.tests.integration.orm_bakeoff.protocol import BakeoffTurnStore

pytestmark = pytest.mark.integration


async def test_concurrent_reservation_single_durable_winner(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    sid = session_id("race")
    key = turn_key("race")
    try:
        outcomes = await asyncio.gather(
            candidate_store.reserve(reserve_request(session_id=sid, turn_key=key)),
            candidate_store.reserve(reserve_request(session_id=sid, turn_key=key)),
        )
        statuses = sorted(outcome.status for outcome in outcomes)
        assert statuses == ["admitted", "in_flight"]
        assert await count_rows(db_pool, session_id=sid, turn_key=key) == 1
    finally:
        await cleanup(db_pool, [sid])


async def test_null_session_reservation_single_winner(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    key = turn_key("null")
    try:
        outcomes = await asyncio.gather(
            candidate_store.reserve(reserve_request(session_id=None, turn_key=key)),
            candidate_store.reserve(reserve_request(session_id=None, turn_key=key)),
        )
        statuses = sorted(outcome.status for outcome in outcomes)
        assert statuses == ["admitted", "in_flight"]
        assert await count_rows(db_pool, session_id=None, turn_key=key) == 1
    finally:
        await cleanup(db_pool, [], turn_keys=[key])


async def test_revision_advances_monotonically(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    sid = session_id("rev")
    try:
        first = await candidate_store.reserve(
            reserve_request(session_id=sid, turn_key=turn_key("a"), expected_revision=0)
        )
        assert first.status == "admitted"
        assert first.revision == 1
        second = await candidate_store.reserve(
            reserve_request(
                session_id=sid,
                turn_key=turn_key("b"),
                expected_revision=first.revision,
            )
        )
        assert second.status == "admitted"
        assert second.revision == 2
        assert await candidate_store.current_revision(sid) == 2
    finally:
        await cleanup(db_pool, [sid])


async def test_stale_expected_revision_rejected(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    sid = session_id("stale")
    try:
        await candidate_store.reserve(
            reserve_request(session_id=sid, turn_key=turn_key("a"))
        )
        outcome = await candidate_store.reserve(
            reserve_request(
                session_id=sid, turn_key=turn_key("b"), expected_revision=99
            )
        )
        assert outcome.status == "stale_revision"
    finally:
        await cleanup(db_pool, [sid])


async def test_completed_row_returns_replay_semantics(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    sid = session_id("replay")
    key = turn_key("replay")
    try:
        await insert_row(
            db_pool, session_id=sid, turn_key=key, revision=7, status="completed"
        )
        outcome = await candidate_store.reserve(
            reserve_request(session_id=sid, turn_key=key)
        )
        assert outcome.status == "replay_completed"
        assert outcome.revision == 7
        assert await count_rows(db_pool, session_id=sid, turn_key=key) == 1
    finally:
        await cleanup(db_pool, [sid])


async def test_failed_row_returns_turn_failed(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    sid = session_id("failed")
    key = turn_key("failed")
    try:
        await insert_row(
            db_pool, session_id=sid, turn_key=key, revision=4, status="failed"
        )
        outcome = await candidate_store.reserve(
            reserve_request(session_id=sid, turn_key=key)
        )
        assert outcome.status == "turn_failed"
        assert outcome.revision == 4
    finally:
        await cleanup(db_pool, [sid])


async def test_reserved_and_running_rows_return_in_flight(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    for status in ("reserved", "running"):
        sid = session_id(status)
        key = turn_key(status)
        try:
            await insert_row(
                db_pool, session_id=sid, turn_key=key, revision=3, status=status
            )
            outcome = await candidate_store.reserve(
                reserve_request(session_id=sid, turn_key=key)
            )
            assert outcome.status == "in_flight"
        finally:
            await cleanup(db_pool, [sid])


async def test_transaction_failure_rolls_back_the_whole_operation(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    sid = session_id("rollback")
    key = turn_key("rollback")
    try:
        with pytest.raises(RuntimeError, match="forced reserve abort"):
            await candidate_store.reserve_then_fail(
                reserve_request(session_id=sid, turn_key=key)
            )
        assert await candidate_store.current_revision(sid) == 0
        assert await count_rows(db_pool, session_id=sid, turn_key=key) == 0
        retry = await candidate_store.reserve(
            reserve_request(session_id=sid, turn_key=key)
        )
        assert retry.status == "admitted"
        assert retry.revision == 1
    finally:
        await cleanup(db_pool, [sid])
