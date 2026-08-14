"""Test-only adapter contract both ORM candidates must satisfy.

Outcome vocabulary and observable database behavior mirror the production
``PostgresTurnReservationStore``. The ownership and session-state digest
gates (which read the ``sessions`` table) are out of scope for the bake-off;
the narrowed port covers the reservation, revision, lease, release, and sweep
behavior the contract gates exercise.
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from animichi.application.turn_admission_port import (
    ReservationOutcome,
    ReserveRequest,
)
from animichi.application.turn_outcome_port import SettleOutcome, SweepReport, TurnRef


class BakeoffTurnStore(Protocol):
    """The narrow turn-reservation adapter both candidates implement."""

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome:
        """One atomic reservation attempt with single-winner semantics."""
        ...

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        """Lease-guarded reserved -> running transition."""
        ...

    async def settle(self, ref: TurnRef, *, owner: str, outcome: SettleOutcome) -> bool:
        """Lease-guarded running -> terminal transition, exactly once."""
        ...

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        """Lease-guarded removal of a never-dispatched reserved row."""
        ...

    async def sweep(
        self, *, now: datetime, owner: str, batch_size: int, lease_seconds: int
    ) -> SweepReport:
        """Claim expired leases in one bounded, concurrent-safe batch."""
        ...

    async def current_revision(self, session_id: str | None) -> int:
        """The session's max reservation revision, 0 when none exists."""
        ...

    async def reserve_then_fail(self, request: ReserveRequest) -> None:
        """Bake-off probe: run the full reserve flow, then abort the transaction.

        Proves a mid-transaction failure rolls back the whole operation.
        """
        ...
