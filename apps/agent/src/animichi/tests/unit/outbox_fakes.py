"""Shared durable-outbox test fakes (issue #1014, AC5).

``MemoryOutbox`` is the in-process ``OutboxStore`` used to prove settle
enqueues durable rows and the drain applies them exactly once, without a
database. It is CAS-delivered like ``SQLModelOutboxStore``: applied rows are
marked delivered so a re-drain never re-applies them.
"""

from __future__ import annotations

from datetime import datetime

from animichi.application.outbox_port import OutboxEntry, OutboxRow


class MemoryOutbox:
    """In-process durable outbox: idempotent (turn_key, kind), CAS drain."""

    def __init__(self) -> None:
        self.rows: list[OutboxEntry] = []
        self.delivered: set[tuple[str, str]] = set()

    async def enqueue(self, entry: OutboxEntry) -> bool:
        key = (entry.turn_key, entry.kind)
        if any((r.turn_key, r.kind) == key for r in self.rows):
            return False
        self.rows.append(entry)
        return True

    def pending_kinds(self) -> set[str]:
        """Return the kinds of rows not yet delivered (settle enqueued)."""
        result: set[str] = set()
        for entry in self.rows:
            if (entry.turn_key, entry.kind) not in self.delivered:
                result.add(entry.kind)
        return result

    async def process_undelivered(
        self, *, now: datetime, batch_size: int, applier: object
    ) -> int:
        del now
        delivered = 0
        for entry in list(self.rows):
            if delivered >= batch_size:
                break
            key = (entry.turn_key, entry.kind)
            if key in self.delivered:
                continue
            row = OutboxRow(
                id=key,
                session_id=entry.session_id,
                turn_key=entry.turn_key,
                kind=entry.kind,
                payload=entry.payload,
            )
            if await applier(object(), row):
                self.delivered.add(key)
                delivered += 1
        return delivered


__all__ = ["MemoryOutbox"]
