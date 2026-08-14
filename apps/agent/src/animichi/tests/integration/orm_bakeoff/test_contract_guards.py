"""Shared cross-table ownership and state-digest reservation guards."""

from __future__ import annotations

import asyncpg
import pytest

from animichi.infrastructure.persistence.repositories.turn_reservation import (
    state_digest,
)
from animichi.tests.integration.orm_bakeoff._contract_helpers import (
    cleanup,
    count_rows,
    insert_session,
    reserve_request,
    session_id,
    turn_key,
)
from animichi.tests.integration.orm_bakeoff.protocol import BakeoffTurnStore

pytestmark = pytest.mark.integration


async def test_existing_session_rejects_the_wrong_identity(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    sid, key = session_id("owner"), turn_key("owner")
    await insert_session(db_pool, session_id=sid, user_id="user-a", state={})
    try:
        outcome = await candidate_store.reserve(
            reserve_request(session_id=sid, turn_key=key, identity_id="user-b")
        )
        assert outcome.status == "ownership"
        assert await count_rows(db_pool, session_id=sid, turn_key=key) == 0
    finally:
        await cleanup(db_pool, [sid])


async def test_existing_session_accepts_its_owner(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    sid, key = session_id("owner"), turn_key("owner")
    await insert_session(db_pool, session_id=sid, user_id="user-a", state={})
    try:
        outcome = await candidate_store.reserve(
            reserve_request(session_id=sid, turn_key=key, identity_id="user-a")
        )
        assert outcome.status == "admitted"
    finally:
        await cleanup(db_pool, [sid])


async def test_session_digest_must_match_the_stored_state(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    sid = session_id("digest")
    state = {"summary": "known", "last_status": "ok"}
    await insert_session(db_pool, session_id=sid, user_id=None, state=state)
    try:
        mismatch = await candidate_store.reserve(
            reserve_request(
                session_id=sid,
                turn_key=turn_key("bad"),
                session_digest="0" * 64,
            )
        )
        assert mismatch.status == "digest_mismatch"
        matching = await candidate_store.reserve(
            reserve_request(
                session_id=sid,
                turn_key=turn_key("good"),
                session_digest=state_digest(state),
            )
        )
        assert matching.status == "admitted"
    finally:
        await cleanup(db_pool, [sid])
