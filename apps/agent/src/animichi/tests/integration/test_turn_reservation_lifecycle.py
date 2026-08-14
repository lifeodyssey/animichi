"""SQLModel turn-lifecycle + grant tests (TURN-2 #949, TURN-3 #951, #994).

The lifecycle tests drive ``SQLModelTurnReservationStore`` over real
PostgreSQL 18 through its public methods; the grant test probes the Atlas
migration's GRANT layer directly and stays an asyncpg infra check (Atlas
migration SQL is outside the repository raw-SQL policy, #999).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import asyncpg
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
)
from animichi.tests.conftest_db import DatabaseTarget

pytestmark = pytest.mark.integration

ANON_ID = "anon_0123456789abcdef0123456789abcdef"
_WRITE_PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE")


def _ids(prefix: str = "sess") -> tuple[str, str]:
    return f"{prefix}-{uuid4().hex}", f"{prefix}-turn"


def _turn_key(prefix: str = "turn") -> str:
    return f"{prefix}-{uuid4().hex}"


async def _cleanup(db: PersistenceRepos, session_ids: list[str | None]) -> None:
    from sqlalchemy import delete

    from animichi.infrastructure.persistence.models import session_table

    ids = [sid for sid in session_ids if sid is not None]
    if not ids:
        return
    async with db.sessionmaker() as session:
        async with session.begin():
            await session.execute(
                delete(reservation_table).where(reservation_table.c.session_id.in_(ids))
            )
            await session.execute(
                delete(session_table).where(session_table.c.id.in_(ids))
            )


async def _reservation_count(db: PersistenceRepos, session_id: str) -> int:
    async with db.sessionmaker() as session:
        result = await session.execute(
            select(func.count())
            .select_from(reservation_table)
            .where(reservation_table.c.session_id == session_id)
        )
    return int(result.scalar_one())


def _reserve(
    *,
    session_id: str | None,
    turn_key: str,
    identity_id: str = ANON_ID,
    payer: UsageScope = "anon",
    expected_revision: int | None = None,
    session_digest: str | None = None,
    owner: str | None = "integration-test",
    lease_expires_at: datetime | None = None,
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


@pytest.mark.parametrize("privilege", _WRITE_PRIVILEGES)
async def test_agent_svc_holds_the_grant(db_pool: asyncpg.Pool, privilege: str) -> None:
    async with db_pool.acquire() as conn:
        held = await conn.fetchval(
            "SELECT has_table_privilege('agent_svc', 'public.turn_reservations', $1)",
            privilege,
        )
    assert held is True


async def test_completed_turn_replays_and_never_re_reserves(
    repos: PersistenceRepos,
) -> None:
    session_id, turn_key = _ids("replay")
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
        assert await store.settle(ref, owner=owner, outcome="completed")
        replay = await store.reserve(_reserve(session_id=session_id, turn_key=turn_key))
        assert replay.status == "replay_completed"
        assert replay.revision == first.revision
        assert await _reservation_count(repos, session_id) == 1
    finally:
        await _cleanup(repos, [session_id])


async def test_ownership_collapse_is_rejected(repos: PersistenceRepos) -> None:
    session_id = f"sess-{uuid4().hex}"
    store: SQLModelTurnReservationStore = repos.turn_reservation
    try:
        await repos.session.create(session_id, "user-a", "q", {})
        outcome = await store.reserve(
            _reserve(
                session_id=session_id,
                turn_key=_turn_key("a"),
                identity_id="user-b",
            )
        )
        assert outcome.status == "ownership"
    finally:
        await _cleanup(repos, [session_id])
