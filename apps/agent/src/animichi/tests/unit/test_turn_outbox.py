"""TurnOutbox (issue #1014, AC5): durable enqueue + exactly-once drain."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from animichi.application.outbox import TurnOutbox
from animichi.application.outbox_port import OutboxEntry, OutboxRow

Kind = Literal["usage", "quota", "audit"]


class _MemoryOutbox:
    """In-process OutboxStore: idempotent on (turn_key, kind), CAS delivered."""

    def __init__(self) -> None:
        self.rows: dict[tuple[str, Kind], dict[str, object]] = {}
        self.delivered: set[object] = set()

    async def enqueue(self, entry: OutboxEntry) -> bool:
        key = (entry.turn_key, entry.kind)
        if key in self.rows:
            return False
        self.rows[key] = {
            "session_id": entry.session_id,
            "payload": entry.payload,
        }
        return True

    async def drain(self, *, now: datetime, batch_size: int) -> list[OutboxRow]:
        del now
        result: list[OutboxRow] = []
        for (turn_key, kind), row in self.rows.items():
            if len(result) >= batch_size:
                break
            if (turn_key, kind) not in self.delivered:
                result.append(
                    OutboxRow(
                        id=(turn_key, kind),
                        session_id=str(row["session_id"])
                        if row["session_id"] is not None
                        else None,
                        turn_key=turn_key,
                        kind=kind,
                        payload=row["payload"],
                    )
                )
        return result

    async def mark_delivered(self, row_id: object, *, success: bool) -> bool:
        if success:
            self.delivered.add(row_id)
        return True


class _RecordingDispatcher:
    """OutboxDispatcher recording each apply and its success."""

    def __init__(self, *, fail: set[Kind] | None = None) -> None:
        self.applied: list[OutboxRow] = []
        self._fail = fail or set()

    async def apply(self, row: OutboxRow) -> bool:
        self.applied.append(row)
        return row.kind not in self._fail


def _now() -> datetime:
    return datetime(2026, 8, 14, tzinfo=UTC)


def _entry(turn_key: str = "turn-1", kind: Kind = "usage") -> OutboxEntry:
    return OutboxEntry(turn_key=turn_key, kind=kind, session_id="s-1", payload={"x": 1})


async def test_enqueue_is_idempotent_per_turn_key_and_kind() -> None:
    outbox = TurnOutbox(store=_MemoryOutbox(), now=_now)

    assert await outbox.enqueue(_entry()) is True
    assert await outbox.enqueue(_entry(kind="quota")) is True
    # Re-enqueueing the same (turn_key, kind) is a no-op, not a duplicate.
    assert await outbox.enqueue(_entry()) is False


async def test_drain_applies_each_undelivered_row_exactly_once() -> None:
    store = _MemoryOutbox()
    outbox = TurnOutbox(store=store, now=_now)
    await outbox.enqueue(_entry())
    await outbox.enqueue(_entry(kind="quota"))
    dispatcher = _RecordingDispatcher()

    delivered = await outbox.drain(dispatcher)

    assert delivered == 2
    assert [r.kind for r in dispatcher.applied] == ["usage", "quota"]
    # Already-delivered rows are not re-drained on a second pass.
    delivered_again = await outbox.drain(dispatcher)
    assert delivered_again == 0
    assert len(dispatcher.applied) == 2


async def test_failed_apply_stays_undelivered_and_is_retried() -> None:
    store = _MemoryOutbox()
    outbox = TurnOutbox(store=store, now=_now)
    await outbox.enqueue(_entry(kind="usage"))
    fail_first = _RecordingDispatcher(fail={"usage"})

    first = await outbox.drain(fail_first)
    assert first == 0
    assert len(fail_first.applied) == 1

    # After the transient failure clears, the same row is delivered.
    succeed = _RecordingDispatcher()
    second = await outbox.drain(succeed)
    assert second == 1
    assert len(succeed.applied) == 1


async def test_drain_batch_is_bounded() -> None:
    store = _MemoryOutbox()
    outbox = TurnOutbox(store=store, now=_now, batch_size=1)
    await outbox.enqueue(_entry())
    await outbox.enqueue(_entry(kind="quota"))
    dispatcher = _RecordingDispatcher()

    assert await outbox.drain(dispatcher) == 1
    assert await outbox.drain(dispatcher) == 1
    assert await outbox.drain(dispatcher) == 0
