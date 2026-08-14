"""
TurnOutbox (issue #1014, AC5) exactly-once external-effect settlement.

External non-transactional effects of a settled turn (usage / quota / audit)
are recorded durably in the outbox and drained exactly once, so a process
crash cannot lose or double-apply them. No FastAPI / PydanticAI import may
appear in this module or any consumer of it.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Protocol

from animichi.application.outbox_port import OutboxEntry, OutboxRow, OutboxStore

#: Bounded batch ceiling for every drain pass (demand-driven).
DEFAULT_OUTBOX_BATCH = 50


class OutboxDispatcher(Protocol):
    """Port: apply one undelivered outbox row to its external system."""

    async def apply(self, row: OutboxRow) -> bool: ...


class TurnOutbox:
    """Owns the durable enqueue and exactly-once drain of external effects."""

    def __init__(
        self,
        *,
        store: OutboxStore,
        batch_size: int = DEFAULT_OUTBOX_BATCH,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._store = store
        self._batch_size = batch_size
        self._now = now

    async def enqueue(self, entry: OutboxEntry) -> bool:
        """Record one handoff; ``False`` when it already exists (idempotent)."""
        return await self._store.enqueue(entry)

    async def drain(
        self,
        dispatcher: OutboxDispatcher,
        *,
        now: datetime | None = None,
    ) -> int:
        """Apply undelivered rows exactly once; return deliveries made."""
        current = now or (self._now() if self._now is not None else datetime.now())
        undelivered = await self._store.drain(now=current, batch_size=self._batch_size)
        delivered = 0
        for row in undelivered:
            if await dispatcher.apply(row):
                await self._store.mark_delivered(row.id, success=True)
                delivered += 1
            else:
                await self._store.mark_delivered(row.id, success=False)
        return delivered
