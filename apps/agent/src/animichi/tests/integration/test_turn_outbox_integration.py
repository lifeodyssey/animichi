"""Real-Postgres contract for the durable turn outbox (issue #1014, AC5).

Proves enqueue persistence, idempotency on (turn_key, kind), exactly-once
drain (delivered_at CAS), and the crash-recovery guarantee on
``SQLModelOutboxStore``: rows enqueued by settle but not yet drained are
applied exactly once by a later drain. Each row\'s dispatch is counted (not
mocked), and a replayed settle of the same turn creates no rows and re-applies
nothing. Type: integration.
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
    """Records each row applied on the drain\'s own transaction."""

    def __init__(self, *, fail_kinds: set[str] | None = None) -> None:
        self.applied: list[OutboxRow] = []
        self.fail_kinds = fail_kinds or set()

    async def apply_session(self, session: object, row: OutboxRow) -> bool:
        del session
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
        assert await outbox.drain(_CountingDispatcher()) == 0
    finally:
        await _cleanup(repos, turn)


async def test_enqueue_applies_each_kind_exactly_once(
    repos: PersistenceRepos,
) -> None:
    """usage/quota/audit rows are each dispatched exactly one delivery."""
    store: SQLModelOutboxStore = repos.outbox
    outbox = TurnOutbox(store=store)
    turn = "kinds-1"
    try:
        for kind in ("usage", "quota", "audit"):
            assert await outbox.enqueue(_entry(turn, kind)) is True
        dispatcher = _CountingDispatcher()
        assert await outbox.drain(dispatcher) == 3
        assert {r.kind for r in dispatcher.applied} == {"usage", "quota", "audit"}
        # Re-draining after delivery applies nothing further.
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


async def test_crash_between_settle_and_drain_recovers_exactly_once(
    repos: PersistenceRepos,
) -> None:
    """Settle committed pending rows, crashed before drain; drain applies once."""
    store: SQLModelOutboxStore = repos.outbox
    outbox = TurnOutbox(store=store)
    turn = "crash-1"
    try:
        assert await outbox.enqueue(_entry(turn)) is True
        assert await outbox.enqueue(_entry(turn, "audit")) is True
        first = _CountingDispatcher()
        assert await outbox.drain(first) == 2
        assert len(first.applied) == 2
        restarted = _CountingDispatcher()
        assert await outbox.drain(restarted) == 0
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


async def test_replayed_settle_creates_no_rows_and_applies_nothing(
    repos: PersistenceRepos,
) -> None:
    """A replayed settle enqueues idempotently; drain re-applies nothing."""
    store: SQLModelOutboxStore = repos.outbox
    outbox = TurnOutbox(store=store)
    turn = "replay-1"
    try:
        assert await outbox.enqueue(_entry(turn)) is True
        # Replayed settle of the same (turn_key, kind) creates no new row.
        assert await outbox.enqueue(_entry(turn)) is False
        dispatcher = _CountingDispatcher()
        assert await outbox.drain(dispatcher) == 1
        assert len(dispatcher.applied) == 1
        assert await outbox.drain(_CountingDispatcher()) == 0
    finally:
        await _cleanup(repos, turn)
