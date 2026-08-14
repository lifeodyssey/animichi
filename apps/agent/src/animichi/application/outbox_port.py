"""Neutral durable-outbox port (issue #1014, AC5).

External non-transactional effects of a settled turn (usage metering, quota
increment, request audit) must not be lost or double-applied across a process
failure. They are recorded as durable outbox rows and dispatched exactly once
by a bounded, demand-driven drain. No FastAPI / PydanticAI import may appear
in this module or any consumer of it.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

OutboxKind = Literal["usage", "quota", "audit"]


@dataclass(frozen=True)
class OutboxEntry:
    """One durable, idempotent external-effect handoff for a settled turn."""

    turn_key: str
    kind: OutboxKind
    session_id: str | None = None
    payload: object | None = None


@dataclass(frozen=True)
class OutboxRow:
    """An undelivered outbox row surfaced to the drain step."""

    id: object
    session_id: str | None
    turn_key: str
    kind: OutboxKind
    payload: object | None


#: Applies one undelivered row's effect on a single caller-owned transaction
#: (AC5). The store runs it on the same ``AsyncSession`` it marks the row
#: delivered with, so effect + mark commit atomically (exactly-once).
OutboxApplier = Callable[[AsyncSession, OutboxRow], Awaitable[bool]]


class OutboxStore(Protocol):
    """Port: enqueue side-effect handoffs and process them exactly once.

    ``enqueue`` is idempotent on ``(turn_key, kind)`` so a retried settle of
    the same turn cannot double-record an effect. ``process_undelivered``
    applies each undelivered row's effect and marks it delivered in ONE
    caller-owned transaction per row: a crash before commit leaves both the
    effect and the delivered-mark rolled back (row re-drains); a crash after
    commit leaves both persisted (row never re-applies). This is the only
    exactly-once guarantee AVAILABLE for non-idempotent effects.
    """

    async def enqueue(self, entry: OutboxEntry) -> bool:
        """Record one handoff; ``False`` when a row for the key already exists."""
        ...

    async def process_undelivered(
        self,
        *,
        now: datetime,
        batch_size: int,
        applier: OutboxApplier,
    ) -> int:
        """Apply up to ``batch_size`` undelivered rows; return deliveries made.

        Each row is processed in its own transaction: the effect is applied via
        ``applier`` on the same session that marks the row delivered.
        """
        ...
