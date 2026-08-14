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

from sqlalchemy.ext.asyncio import AsyncSession

from animichi.application.outbox_port import OutboxEntry, OutboxRow, OutboxStore

#: Bounded batch ceiling for every drain pass (demand-driven).
DEFAULT_OUTBOX_BATCH = 50


class OutboxDispatcher(Protocol):
    """Apply one undelivered outbox row on a caller-owned transaction (AC5).

    ``apply_session`` runs the row's external effect on the supplied
    transaction; the store commits it together with the delivered-mark, so a
    crash cannot leave the effect applied but undelivered (double-charge) nor
    delivered-but-unapplied (lost).
    """

    async def apply_session(self, session: AsyncSession, row: OutboxRow) -> bool: ...


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
        """Apply undelivered rows exactly once; return deliveries made.

        Delegates to the store's per-row transactional processing so each effect
        and its delivered-mark commit together (AC5).
        """
        current = now or (self._now() if self._now is not None else datetime.now())
        return await self._store.process_undelivered(
            now=current,
            batch_size=self._batch_size,
            applier=dispatcher.apply_session,
        )
