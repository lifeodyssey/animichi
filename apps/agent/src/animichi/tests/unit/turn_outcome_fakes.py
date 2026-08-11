"""Shared fakes for the TurnOutcome seam tests (TURN-3 #951).

A clock, a call-order recorder wrapping :class:`FakeTurnReservationStore`, and
the lifecycle/lease helpers both ``test_turn_outcome`` and
``test_turn_outcome_sweep`` drive.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from animichi.application.turn_admission_port import (
    ReservationOutcome,
    ReserveRequest,
)
from animichi.application.turn_outcome import TurnOutcome
from animichi.application.turn_outcome_port import (
    SettleOutcome,
    SweepReport,
    TurnRef,
)
from animichi.tests.unit.turn_admission_fakes import (
    FakeTurnReservationStore,
    _admission,
)

START = datetime(2026, 8, 11, 12, 0, tzinfo=UTC)
LEASE = 300


class Clock:
    def __init__(self, now: datetime = START) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: int) -> None:
        self.now = self.now + timedelta(seconds=seconds)


class RecordingStore:
    """Wraps the fake, recording the call order of the lifecycle methods."""

    def __init__(self, inner: FakeTurnReservationStore) -> None:
        self._inner = inner
        self.order: list[str] = []

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome:
        self.order.append("reserve")
        return await self._inner.reserve(request)

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        self.order.append("dispatch")
        return await self._inner.dispatch(ref, owner=owner)

    async def settle(self, ref: TurnRef, *, owner: str, outcome: SettleOutcome) -> bool:
        self.order.append("settle")
        return await self._inner.settle(ref, owner=owner, outcome=outcome)

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        self.order.append("release")
        return await self._inner.release(ref, owner=owner)

    async def sweep(self, *, now: datetime, owner: str, batch_size: int) -> SweepReport:
        self.order.append("sweep")
        return await self._inner.sweep(now=now, owner=owner, batch_size=batch_size)


def make_outcome(
    store: FakeTurnReservationStore,
    *,
    clock: Clock | None = None,
    sweep_batch: int = 50,
) -> tuple[TurnOutcome, Clock]:
    resolved_clock = clock or Clock()
    store.use_clock(resolved_clock)
    outcome = TurnOutcome(
        store=store,
        admission=_admission(store, now=resolved_clock),
        now=resolved_clock,
        lease_seconds=LEASE,
        sweep_batch=sweep_batch,
    )
    return outcome, resolved_clock


def ref(session_id: str | None = "s-1", turn_key: str = "turn-1") -> TurnRef:
    return TurnRef(session_id=session_id, turn_key=turn_key)
