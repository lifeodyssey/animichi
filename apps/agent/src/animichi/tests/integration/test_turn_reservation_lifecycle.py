"""PostgresTurnReservationStore lifecycle + grant tests (TURN-2 #949)."""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from animichi.application.turn_admission_port import ReserveRequest
from animichi.infrastructure.turn_reservation.postgres import (
    PostgresTurnReservationStore,
)

pytestmark = pytest.mark.integration

ANON_ID = "anon_0123456789abcdef0123456789abcdef"


def _ids(prefix: str = "sess") -> tuple[str, str]:
    return f"{prefix}-{uuid.uuid4().hex}", f"{prefix}-turn"


def _turn_key(prefix: str = "turn") -> str:
    return f"{prefix}-{uuid.uuid4().hex}"


async def _cleanup(db_pool: asyncpg.Pool, session_ids: list[str | None]) -> None:
    if not session_ids:
        return
    async with db_pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM turn_reservations WHERE session_id = ANY($1::text[])",
            [sid for sid in session_ids if sid is not None],
        )


def _reserve(
    *,
    session_id: str | None,
    turn_key: str,
    identity_id: str = ANON_ID,
    payer: str = "anon",
    expected_revision: int | None = None,
    session_digest: str | None = None,
) -> ReserveRequest:
    return ReserveRequest(
        session_id=session_id,
        turn_key=turn_key,
        identity_id=identity_id,
        payer=payer,
        expected_revision=expected_revision,
        session_digest=session_digest,
    )


async def test_agent_svc_holds_the_grant(db_pool: asyncpg.Pool, privilege: str) -> None:
    async with db_pool.acquire() as conn:
        held = await conn.fetchval(
            "SELECT has_table_privilege('agent_svc', 'public.turn_reservations', $1)",
            privilege,
        )
    assert held is True


async def test_completed_turn_replays_and_never_re_reserves(
    db_pool: asyncpg.Pool,
) -> None:
    session_id, turn_key = _ids("replay")
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
