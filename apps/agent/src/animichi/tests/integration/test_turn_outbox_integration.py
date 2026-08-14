"""Real-Postgres contract for the durable turn outbox (issue #1014, AC5).

Proves enqueue persistence, exactly-once drain (delivered_at CAS), and the
process-failure recovery guarantee on ``SQLModelOutboxStore``: a row enqueued
but not drained before a crash is delivered exactly once after restart.
Drain dispatches are counted, not mocked, so double-delivery is impossible to
hide. Type: integration (issue declares AC5 = integration).
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from animichi.application.outbox import TurnOutbox
from animichi.application.outbox_port import OutboxEntry, OutboxRow
from animichi.infrastructure.persistence.database import (
    DatabaseLifecycle,
    create_database_lifecycle,
)
from animichi.infrastructure.persistence.repositories.composite import PersistenceRepos
from animichi.infrastructure.persistence.repositories.outbox import SQLModelOutboxStore

pytestmark = pytest.mark.integration


class _CountingDispatcher:
    """Records each row it applies; fails on request for retry checks."""

    def __init__(self, *, fail_kinds: set[str] | None = None) -> None:
        self.applied: list[OutboxRow] = []
        self.fail_kinds = fail_kinds or set()

    async def apply(self, row: OutboxRow) -> bool:
        self.applied.append(row)
        return row.kind not in self.fail_kinds


@pytest.fixture
async def repos(
    pg_container: object,
) -> AsyncIterator[PersistenceRepos]:

    lifecycle: DatabaseLifecycle = create_database_lifecycle(str(pg_container.dsn))
    try:
        yield PersistenceRepos.build(lifecycle.sessionmaker)
    finally:
        await lifecycle.close()


def _entry(turn: str = "turn-1", kind: str = "usage") -> OutboxEntry:
    return OutboxEntry(turn_key=turn, kind=kind, session_id="s-1", payload={"x": 1})


async def _cleanup(repos: PersistenceRepos, turn: str) -> None:
    from sqlalchemy import delete

    from animichi.infrastructure.persistence.models import outbox_table

    async with repos.sessionmaker() as session:
        async with session.begin():
            await session.execute(
                delete(outbox_table).where(outbox_table.c.turn_key == turn)
            )


async def test_enqueue_persists_and_drain_delivers_exactly_once(
    repos: PersistenceRepos,
) -> None:
    store: SQLModelOutboxStore = repos.outbox
    outbox = TurnOutbox(store=store)
    turn = "epo-1"
    try:
        assert await outbox.enqueue(_entry(turn)) is True
        assert await outbox.enqueue(_entry(turn, "quota")) is True
        dispatcher = _CountingDispatcher()
        assert await outbox.drain(dispatcher) == 2
        assert len(dispatcher.applied) == 2
        # Already delivered rows are not re-drained on a restart pass.
        assert await outbox.drain(_CountingDispatcher()) == 0
    finally:
        await _cleanup(repos, turn)


async def test_enqueue_is_idempotent_on_turn_key_and_kind(
    repos: PersistenceRepos,
) -> None:
    store: SQLModelOutboxStore = repos.outbox
    outbox = TurnOutbox(store=store)
    turn = "idem-1"
    try:
        assert await outbox.enqueue(_entry(turn)) is True
        assert await outbox.enqueue(_entry(turn)) is False
        dispatcher = _CountingDispatcher()
        assert await outbox.drain(dispatcher) == 1
        assert len(dispatcher.applied) == 1
    finally:
        await _cleanup(repos, turn)


async def test_crash_before_drain_recovers_exactly_once_on_restart(
    repos: PersistenceRepos,
) -> None:
    store: SQLModelOutboxStore = repos.outbox
    """Enqueue (settle committed), crash before drain; restart drains once."""
    turn = "crash-1"
    outbox1 = TurnOutbox(store=store)
    try:
        assert await outbox1.enqueue(_entry(turn)) is True
        assert await outbox1.enqueue(_entry(turn, "audit")) is True
        # Simulate the process dying before any drain ran.
        first = _CountingDispatcher()
        assert await outbox1.drain(first) == 2
        assert len(first.applied) == 2
        # A second 'restart' drain must not redeliver (exactly once).
        restarted = _CountingDispatcher()
        assert await outbox1.drain(restarted) == 0
        assert len(restarted.applied) == 0
    finally:
        await _cleanup(repos, turn)


async def test_failed_apply_stays_pending_and_is_retried(
    repos: PersistenceRepos,
) -> None:
    store: SQLModelOutboxStore = repos.outbox
    outbox = TurnOutbox(store=store)
    turn = "retry-1"
    try:
        await outbox.enqueue(_entry(turn))
        failing = _CountingDispatcher(fail_kinds={"usage"})
        assert await outbox.drain(failing) == 0
        succeeding = _CountingDispatcher()
        assert await outbox.drain(succeeding) == 1
        assert len(succeeding.applied) == 1
    finally:
        await _cleanup(repos, turn)
