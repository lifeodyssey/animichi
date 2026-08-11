"""Real-SQL contract for PostgresTurnReservationStore (TURN-2 #949).

The unit seam runs the sanctioned in-process fake; this suite proves the
actual SQL: the durable UNIQUE winner under real concurrency, replay /
in-flight detection, revision/digest/ownership gates, the complete/fail
lifecycle, and the migration's GRANT. Removing the UNIQUE constraint — the
"one durable winner" mutation — turns the concurrency test red.
"""

from __future__ import annotations

import asyncio
import json
import uuid

import asyncpg
import pytest

from animichi.application.turn_admission_port import ReserveRequest
from animichi.infrastructure.turn_reservation.postgres import (
    PostgresTurnReservationStore,
    state_digest,
)

pytestmark = pytest.mark.integration

ANON_ID = "anon_0123456789abcdef0123456789abcdef"


def _turn_key(prefix: str = "turn") -> str:
    return f"{prefix}-{uuid.uuid4().hex}"


async def _cleanup(pool: asyncpg.Pool, session_ids: list[str]) -> None:
    await pool.execute(
        "DELETE FROM turn_reservations WHERE session_id = ANY($1::text[])",
        session_ids,
    )
    await pool.execute("DELETE FROM sessions WHERE id = ANY($1::text[])", session_ids)
    await pool.execute(
        "DELETE FROM conversations WHERE session_id = ANY($1::text[])",
        session_ids,
    )


def _reserve(
    *,
    session_id: str | None,
    turn_key: str,
    identity_id: str | None = ANON_ID,
    expected_revision: int | None = None,
    session_digest: str | None = None,
) -> ReserveRequest:
    return ReserveRequest(
        session_id=session_id,
        turn_key=turn_key,
        identity_id=identity_id,
        payer="anon",
        expected_revision=expected_revision,
        session_digest=session_digest,
    )


@pytest.mark.parametrize("privilege", ("SELECT", "INSERT", "UPDATE", "DELETE"))
async def test_agent_svc_holds_the_grant(db_pool: asyncpg.Pool, privilege: str) -> None:
    async with db_pool.acquire() as conn:
        held = await conn.fetchval(
            "SELECT has_table_privilege('agent_svc', 'public.turn_reservations', $1)",
            privilege,
        )
    assert held is True


async def test_initial_and_continued_admission_advance_the_revision(
    db_pool: asyncpg.Pool,
) -> None:
    session_id = f"sess-{uuid.uuid4().hex}"
    store = PostgresTurnReservationStore(db_pool)
    try:
        first = await store.reserve(
            _reserve(
                session_id=session_id, turn_key=_turn_key("a"), expected_revision=0
            )
        )
        assert first.status == "admitted"
        assert first.revision == 1
        second = await store.reserve(
            _reserve(
                session_id=session_id,
                turn_key=_turn_key("b"),
                expected_revision=first.revision,
            )
        )
        assert second.status == "admitted"
        assert second.revision == 2
    finally:
        await _cleanup(db_pool, [session_id])


async def test_one_durable_winner_under_concurrent_reservation(
    db_pool: asyncpg.Pool,
) -> None:
    session_id = f"sess-{uuid.uuid4().hex}"
    turn_key = _turn_key("race")
    store = PostgresTurnReservationStore(db_pool)
    try:
        outcomes = await asyncio.gather(
            store.reserve(_reserve(session_id=session_id, turn_key=turn_key)),
            store.reserve(_reserve(session_id=session_id, turn_key=turn_key)),
        )
        statuses = sorted(outcome.status for outcome in outcomes)
        assert statuses.count("admitted") == 1
        assert "in_flight" in statuses
        async with db_pool.acquire() as conn:
            count = await conn.fetchval(
                "SELECT count(*) FROM turn_reservations WHERE session_id = $1 AND turn_key = $2",
                session_id,
                turn_key,
            )
        assert count == 1
    finally:
        await _cleanup(db_pool, [session_id])


async def test_completed_turn_replays_and_never_re_reserves(
    db_pool: asyncpg.Pool,
) -> None:
    session_id = f"sess-{uuid.uuid4().hex}"
    turn_key = _turn_key("replay")
    store = PostgresTurnReservationStore(db_pool)
    try:
        first = await store.reserve(_reserve(session_id=session_id, turn_key=turn_key))
        await store.complete(session_id=session_id, turn_key=turn_key)
        replay = await store.reserve(_reserve(session_id=session_id, turn_key=turn_key))
        assert replay.status == "replay_completed"
        assert replay.revision == first.revision
        async with db_pool.acquire() as conn:
            count = await conn.fetchval(
                "SELECT count(*) FROM turn_reservations WHERE session_id = $1",
                session_id,
            )
        assert count == 1
    finally:
        await _cleanup(db_pool, [session_id])


async def test_in_flight_turn_is_detected(db_pool: asyncpg.Pool) -> None:
    session_id = f"sess-{uuid.uuid4().hex}"
    turn_key = _turn_key("inflight")
    store = PostgresTurnReservationStore(db_pool)
    try:
        await store.reserve(_reserve(session_id=session_id, turn_key=turn_key))
        second = await store.reserve(_reserve(session_id=session_id, turn_key=turn_key))
        assert second.status == "in_flight"
    finally:
        await _cleanup(db_pool, [session_id])


async def test_stale_revision_is_rejected(db_pool: asyncpg.Pool) -> None:
    session_id = f"sess-{uuid.uuid4().hex}"
    store = PostgresTurnReservationStore(db_pool)
    try:
        await store.reserve(_reserve(session_id=session_id, turn_key=_turn_key("a")))
        outcome = await store.reserve(
            _reserve(
                session_id=session_id,
                turn_key=_turn_key("b"),
                expected_revision=99,
            )
        )
        assert outcome.status == "stale_revision"
    finally:
        await _cleanup(db_pool, [session_id])


async def test_digest_mismatch_is_rejected(db_pool: asyncpg.Pool) -> None:
    session_id = f"sess-{uuid.uuid4().hex}"
    store = PostgresTurnReservationStore(db_pool)
    state = {"summary": "known", "last_status": "ok"}
    try:
        async with db_pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO sessions (id, state) VALUES ($1, $2::jsonb)",
                session_id,
                json.dumps(state),
            )
        outcome = await store.reserve(
            _reserve(
                session_id=session_id,
                turn_key=_turn_key("a"),
                session_digest="0" * 64,
            )
        )
        assert outcome.status == "digest_mismatch"
        matching = await store.reserve(
            _reserve(
                session_id=session_id,
                turn_key=_turn_key("b"),
                session_digest=state_digest(state),
            )
        )
        assert matching.status == "admitted"
    finally:
        await _cleanup(db_pool, [session_id])


async def test_ownership_collapse_is_rejected(db_pool: asyncpg.Pool) -> None:
    session_id = f"sess-{uuid.uuid4().hex}"
    store = PostgresTurnReservationStore(db_pool)
    try:
        async with db_pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO sessions (id, state) VALUES ($1, '{}'::jsonb)",
                session_id,
            )
            await conn.execute(
                "INSERT INTO conversations (session_id, user_id, first_query) "
                "VALUES ($1, $2, 'seed')",
                session_id,
                "user-a",
            )
        outcome = await store.reserve(
            _reserve(
                session_id=session_id,
                turn_key=_turn_key("a"),
                identity_id="user-b",
            )
        )
        assert outcome.status == "ownership"
    finally:
        await _cleanup(db_pool, [session_id])


async def test_fail_releases_the_reservation(db_pool: asyncpg.Pool) -> None:
    session_id = f"sess-{uuid.uuid4().hex}"
    turn_key = _turn_key("release")
    store = PostgresTurnReservationStore(db_pool)
    try:
        first = await store.reserve(_reserve(session_id=session_id, turn_key=turn_key))
        await store.fail(session_id=session_id, turn_key=turn_key)
        retry = await store.reserve(_reserve(session_id=session_id, turn_key=turn_key))
        assert retry.status == "admitted"
        assert retry.revision == first.revision
    finally:
        await _cleanup(db_pool, [session_id])
