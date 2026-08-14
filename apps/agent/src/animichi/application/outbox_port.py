"""Neutral durable-outbox port (issue #1014, AC5).

External non-transactional effects of a settled turn (usage metering, quota
increment, request audit) must not be lost or double-applied across a process
failure. They are recorded as durable outbox rows and dispatched exactly once
by a bounded, demand-driven drain. No FastAPI / PydanticAI import may appear
in this module or any consumer of it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

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


class OutboxStore(Protocol):
    """Port: enqueue side-effect handoffs and drain them exactly once.

    ``enqueue`` is idempotent on ``(turn_key, kind)`` so a retried settle of
    the same turn cannot double-record an effect. ``drain`` claims a bounded
    batch of undelivered rows (skip-locked) and ``mark_delivered`` is the
    exactly-once CAS marker a consumer sets after applying the effect.
    """

    async def enqueue(self, entry: OutboxEntry) -> bool:
        """Record one handoff; ``False`` when a row for the key already exists."""
        ...

    async def drain(self, *, now: datetime, batch_size: int) -> list[OutboxRow]:
        """Claim up to ``batch_size`` undelivered rows in a bounded batch."""
        ...

    async def mark_delivered(self, row_id: object, *, success: bool) -> bool:
        """Mark a claimed row delivered (CAS); ``False`` when already delivered."""
        ...

    async def mark_delivered_for(
        self,
        session_id: str | None,
        turn_key: str,
        kind: OutboxKind,
        *,
        success: bool,
    ) -> bool:
        """Mark the row for one ``(session_id, turn_key, kind)`` delivered;
        ``False`` when no matching undelivered row exists."""
        ...
