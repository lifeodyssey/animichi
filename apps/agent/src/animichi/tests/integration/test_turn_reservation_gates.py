"""Real-Postgres contract for the turn-reservation admission/revision gates.

Split from ``test_turn_reservation_store.py`` (#992 F5: keep every test file
at or under 200 lines). Proves in-flight detection, stale-revision rejection,
and digest-mismatch rejection through ``SQLModelTurnReservationStore``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import delete

from animichi.application.identity import UsageScope
from animichi.application.turn_admission_port import ReserveRequest
from animichi.infrastructure.persistence.database import (
    DatabaseLifecycle,
    create_database_lifecycle,
)
from animichi.infrastructure.persistence.models import reservation_table, session_table
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


async def test_in_flight_turn_is_detected(repos: PersistenceRepos) -> None:
    session_id = f"sess-{uuid4().hex}"
    turn_key = _turn_key("inflight")
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
