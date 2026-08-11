"""Neutral turn-outcome port (TURN-3 #951).

The durable turn lifecycle lives behind this port: a reservation is created
``reserved`` with a lease (owner + expiry), becomes ``running`` at the
dispatch-certainty point (the provider call is in flight — never replayable),
and settles to a terminal state exactly once. The bounded, demand-driven
sweep reclaims stale leases. No FastAPI / PydanticAI import may appear in this
module or any consumer of it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from animichi.application.turn_admission_port import (
    ReservationOutcome,
    ReserveRequest,
)

TurnState = Literal["reserved", "running", "completed", "failed"]

#: Terminal settle outcome for an already-dispatched turn.
SettleOutcome = Literal["completed", "failed"]


@dataclass(frozen=True)
class TurnRef:
    """Identifies one reserved turn for its lease-guarded transitions."""

    session_id: str | None
    turn_key: str


@dataclass(frozen=True)
class SweepReport:
    """What one demand-driven sweep reclaimed.

    ``released`` rows were ``reserved`` with an expired lease — never
    dispatched, so releasing them is safe and frees the caller to retry.
    ``failed`` rows were ``running`` with an expired lease — the provider call
    was uncertain, so they are tombstoned ``failed`` and never replayed.
    """

    released: int = 0
    failed: int = 0


class TurnOutcomeStore(Protocol):
    """Port: one durable, lease-guarded turn lifecycle."""

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome: ...

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        """Transition ``reserved`` -> ``running`` (dispatch certainty).

        ``False`` when the lease was already lost or the turn was not
        ``reserved`` — the caller must then not proceed to a provider call.
        """
        ...

    async def settle(self, ref: TurnRef, *, owner: str, outcome: SettleOutcome) -> bool:
        """Transition ``running`` -> terminal, exactly once (CAS guard).

        Only the lease holder wins; a concurrent sweep or a second settle gets
        ``False`` so settlement side effects apply exactly once.
        """
        ...

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        """Delete a never-dispatched ``reserved`` turn (lease-guarded)."""
        ...

    async def sweep(self, *, now: datetime, owner: str, batch_size: int) -> SweepReport:
        """Reclaim expired leases in a bounded batch (concurrent-safe)."""
        ...
