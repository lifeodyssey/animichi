"""Real-Postgres contract: reservation admission + concurrency (TURN-2 #949).

Proves the durable UNIQUE winner under real concurrency and the revision gate
advancing admission. The terminal-lifecycle (replay/failed tombstone) tests
live in ``test_turn_reservation_terminal.py``. Typed SQLAlchemy only.
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from animichi.infrastructure.persistence.models import reservation_table
from animichi.infrastructure.persistence.repositories.composite import PersistenceRepos
from animichi.infrastructure.persistence.repositories.turn_reservation import (
    SQLModelTurnReservationStore,
)
from animichi.tests.integration.turn_reservation_fakes import (
    _cleanup,
    _ids,
    _reserve,
    _turn_key,
)

pytestmark = pytest.mark.integration


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
