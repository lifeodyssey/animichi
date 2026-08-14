"""Shared lease compare-and-set contract for both ORM candidates."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from animichi.application.turn_outcome_port import TurnRef
from animichi.tests.integration.orm_bakeoff._contract_helpers import (
    cleanup,
    count_rows,
    fetch_status,
    reserve_request,
    session_id,
    turn_key,
)
from animichi.tests.integration.orm_bakeoff.protocol import BakeoffTurnStore

pytestmark = pytest.mark.integration
PAST = datetime.now(UTC) - timedelta(seconds=30)


def _ref(sid: str, key: str) -> TurnRef:
    return TurnRef(session_id=sid, turn_key=key)


async def test_dispatch_requires_a_valid_lease(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    sid, key, owner = session_id("cas"), turn_key("cas"), uuid.uuid4().hex
    try:
        request = reserve_request(
            session_id=sid, turn_key=key, owner=owner, lease_expires_at=PAST
        )
        await candidate_store.reserve(request)
        assert await candidate_store.dispatch(_ref(sid, key), owner=owner) is False
        assert await fetch_status(db_pool, session_id=sid, turn_key=key) == "reserved"
    finally:
        await cleanup(db_pool, [sid])


async def test_dispatch_transitions_once_and_rejects_wrong_owner(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    sid, key, owner = session_id("dispatch"), turn_key("dispatch"), uuid.uuid4().hex
    try:
        await candidate_store.reserve(
            reserve_request(session_id=sid, turn_key=key, owner=owner)
        )
        assert await candidate_store.dispatch(_ref(sid, key), owner=owner) is True
        assert await candidate_store.dispatch(_ref(sid, key), owner=owner) is False
        assert await candidate_store.dispatch(_ref(sid, key), owner="other") is False
        assert await fetch_status(db_pool, session_id=sid, turn_key=key) == "running"
    finally:
        await cleanup(db_pool, [sid])


async def test_settle_is_exactly_once_and_lease_guarded(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    sid, key, owner = session_id("settle"), turn_key("settle"), uuid.uuid4().hex
    try:
        await candidate_store.reserve(
            reserve_request(session_id=sid, turn_key=key, owner=owner)
        )
        await candidate_store.dispatch(_ref(sid, key), owner=owner)
        assert await candidate_store.settle(
            _ref(sid, key), owner=owner, outcome="completed"
        )
        assert not await candidate_store.settle(
            _ref(sid, key), owner=owner, outcome="completed"
        )
        assert await fetch_status(db_pool, session_id=sid, turn_key=key) == "completed"
    finally:
        await cleanup(db_pool, [sid])


async def test_release_deletes_only_an_owned_reserved_row(
    candidate_store: BakeoffTurnStore, db_pool: asyncpg.Pool
) -> None:
    sid, key, owner = session_id("release"), turn_key("release"), uuid.uuid4().hex
    try:
        await candidate_store.reserve(
            reserve_request(session_id=sid, turn_key=key, owner=owner)
        )
        assert not await candidate_store.release(_ref(sid, key), owner="other")
        assert await count_rows(db_pool, session_id=sid, turn_key=key) == 1
        assert await candidate_store.release(_ref(sid, key), owner=owner)
        assert await count_rows(db_pool, session_id=sid, turn_key=key) == 0
    finally:
        await cleanup(db_pool, [sid])
