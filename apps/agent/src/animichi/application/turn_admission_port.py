"""Neutral turn-reservation port (TURN-2 #949).

The admission use case (``application.turn_admission``) speaks this port; the
production adapter (``infrastructure.turn_reservation``) owns the durable
``turn_reservations`` row. No FastAPI / PydanticAI import may appear in this
module or any consumer of it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

from animichi.application.identity import UsageScope

AdmissionStatus = Literal[
    "admitted",
    "in_flight",
    "replay_completed",
    "ownership",
    "stale_revision",
    "digest_mismatch",
]


@dataclass(frozen=True)
class ReserveRequest:
    """Neutral input for one durable reservation attempt."""

    session_id: str | None
    turn_key: str
    identity_id: str | None
    payer: UsageScope
    expected_revision: int | None = None
    session_digest: str | None = None


@dataclass(frozen=True)
class ReservationOutcome:
    """Result of one atomic ``reserve`` call.

    ``revision`` is the reserved session revision (admitted and
    replay-completed only); ``status`` carries the single-winner verdict.
    """

    status: AdmissionStatus
    session_id: str | None = None
    revision: int | None = None


class TurnReservationStore(Protocol):
    """Port: one durable, atomic turn reservation per admission."""

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome: ...

    async def complete(self, *, session_id: str | None, turn_key: str) -> None: ...

    async def fail(self, *, session_id: str | None, turn_key: str) -> None:
        """Release a reserved turn rejected after reservation (drops the row)."""
