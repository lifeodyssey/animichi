"""Real-Postgres contract for the SQLModel turn-reservation store (TURN-2 #949).

Proves the durable UNIQUE winner under real concurrency, replay/in-flight
detection, revision/digest/ownership gates, and the terminal lifecycle
through ``SQLModelTurnReservationStore``'s public methods — typed
SQLAlchemy statements only, no raw SQL (raw-SQL policy, #999).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from animichi.application.identity import UsageScope
from animichi.application.turn_admission_port import ReserveRequest
from animichi.application.turn_outcome_port import TurnRef
from animichi.infrastructure.persistence.database import (
    DatabaseLifecycle,
    create_database_lifecycle,
)
from animichi.infrastructure.persistence.models import reservation_table
from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.infrastructure.persistence.repositories.turn_reservation import (
    SQLModelTurnReservationStore,
    state_digest,
)
from animichi.tests.conftest_db import DatabaseTarget

pytestmark = pytest.mark.integration

ANON_ID = "anon_0123456789abcdef0123456789abcdef"


def _turn_key(prefix: str = "turn") -> str:
    return f"{prefix}-{uuid4().hex}"


async def _cleanup(db: PersistenceRepos, session_ids: list[str]) -> None:
    from sqlalchemy import delete

    from animichi.infrastructure.persistence.models import session_table

    async with db.sessionmaker() as session:
        async with session.begin():
            await session.execute(
                delete(reservation_table).where(
                    reservation_table.c.session_id.in_(session_ids)
                )
            )
            await session.execute(
                delete(session_table).where(session_table.c.id.in_(session_ids))
            )


async def _reservation_count(db: PersistenceRepos, session_id: str) -> int:
    async with db.sessionmaker() as session:
        result = await session.execute(
            select(func.count())
            .select_from(reservation_table)
            .where(reservation_table.c.session_id == session_id)
        )
    return int(result.scalar_one())


def _ids(prefix: str = "sess") -> tuple[str, str]:
    return f"{prefix}-{uuid4().hex}", _turn_key(prefix)


def _reserve(
    *,
    session_id: str | None,
    turn_key: str,
    identity_id: str | None = ANON_ID,
    expected_revision: int | None = None,
    session_digest: str | None = None,
    owner: str | None = "integration-test",
    lease_expires_at: datetime | None = None,
    payer: UsageScope = "anon",
) -> ReserveRequest:
    expires_at = lease_expires_at or datetime.now(UTC) + timedelta(minutes=1)
    return ReserveRequest(
        session_id=session_id,
        turn_key=turn_key,
        identity_id=identity_id,
        payer=payer,
        expected_revision=expected_revision,
        session_digest=session_digest,
        owner=owner,
        lease_expires_at=expires_at,
    )


@pytest.fixture
async def repos(
    pg_container: DatabaseTarget,
) -> AsyncIterator[PersistenceRepos]:
    lifecycle: DatabaseLifecycle = create_database_lifecycle(pg_container.dsn)
    try:
        yield PersistenceRepos.build(lifecycle.sessionmaker)
    finally:
        await lifecycle.close()


async def test_initial_and_continued_admission_advance_the_revision(
    repos: PersistenceRepos,
) -> None:
    session_id = f"sess-{uuid4().hex}"
    store: SQLModelTurnReservationStore = repos.turn_reservation
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
        await _cleanup(repos, [session_id])


async def test_one_durable_winner_under_concurrent_reservation(
    repos: PersistenceRepos,
) -> None:
    session_id, turn_key = _ids("race")
    store: SQLModelTurnReservationStore = repos.turn_reservation
    try:
        outcomes = await asyncio.gather(
            store.reserve(_reserve(session_id=session_id, turn_key=turn_key)),
            store.reserve(_reserve(session_id=session_id, turn_key=turn_key)),
        )
        statuses = sorted(outcome.status for outcome in outcomes)
        assert statuses.count("admitted") == 1
        assert "in_flight" in statuses
        async with repos.sessionmaker() as session:
            result = await session.execute(
                select(func.count())
                .select_from(reservation_table)
                .where(
                    reservation_table.c.session_id == session_id,
                    reservation_table.c.turn_key == turn_key,
                )
            )
        assert int(result.scalar_one()) == 1
    finally:
        await _cleanup(repos, [session_id])


async def test_in_flight_turn_is_detected(repos: PersistenceRepos) -> None:
    session_id, turn_key = _ids("inflight")
    store: SQLModelTurnReservationStore = repos.turn_reservation
    try:
        await store.reserve(_reserve(session_id=session_id, turn_key=turn_key))
        second = await store.reserve(_reserve(session_id=session_id, turn_key=turn_key))
        assert second.status == "in_flight"
    finally:
        await _cleanup(repos, [session_id])


async def test_stale_revision_is_rejected(repos: PersistenceRepos) -> None:
    session_id = f"sess-{uuid4().hex}"
    store: SQLModelTurnReservationStore = repos.turn_reservation
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
        await _cleanup(repos, [session_id])


async def test_digest_mismatch_is_rejected(repos: PersistenceRepos) -> None:
    session_id = f"sess-{uuid4().hex}"
    store: SQLModelTurnReservationStore = repos.turn_reservation
    state: dict[str, object] = {"summary": "known", "last_status": "ok"}
    try:
        await repos.session.create(session_id, ANON_ID, "q", state)
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
        await _cleanup(repos, [session_id])


async def test_failed_turn_is_a_non_replayable_tombstone(
    repos: PersistenceRepos,
) -> None:
    session_id, turn_key = _ids("failed")
    owner = uuid4().hex
    store: SQLModelTurnReservationStore = repos.turn_reservation
    try:
        first = await store.reserve(
            _reserve(
                session_id=session_id,
                turn_key=turn_key,
                owner=owner,
                lease_expires_at=datetime.now(UTC) + timedelta(minutes=1),
            )
        )
        ref = TurnRef(session_id=session_id, turn_key=turn_key)
        assert await store.dispatch(ref, owner=owner)
        assert await store.settle(ref, owner=owner, outcome="failed")
        retry = await store.reserve(_reserve(session_id=session_id, turn_key=turn_key))
        assert retry.status == "turn_failed"
        assert retry.revision == first.revision
    finally:
        await _cleanup(repos, [session_id])
