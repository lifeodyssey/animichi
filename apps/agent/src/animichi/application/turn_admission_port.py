"""Neutral turn-reservation port (TURN-2 #949, TURN-3 #951).

The admission use case (``application.turn_admission``) speaks this port; the
production adapter (``infrastructure.turn_reservation``) owns the durable
``turn_reservations`` row. ``ReserveRequest``/``ReservationOutcome`` carry the
lease (``owner`` + ``lease_expires_at``) TURN-3 grants on every reservation.
The full lifecycle port (dispatch/settle/release/sweep) lives in
``application.turn_outcome_port``. No FastAPI / PydanticAI import may appear
in this module or any consumer of it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from animichi.application.identity import UsageScope

AdmissionStatus = Literal[
    "admitted",
    "in_flight",
    "replay_completed",
    "ownership",
    "stale_revision",
    "digest_mismatch",
    "turn_failed",
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
    owner: str | None = None
    lease_expires_at: datetime | None = None


@dataclass(frozen=True)
class ReservationOutcome:
    """Result of one atomic ``reserve`` call.

    ``revision`` is the reserved session revision (admitted and
    replay-completed only); ``status`` carries the single-winner verdict.
    ``owner``/``lease_expires_at`` echo the granted lease back to the caller
    (admitted only) so the route can drive dispatch/settle/release.
    """

    status: AdmissionStatus
    session_id: str | None = None
    revision: int | None = None
    owner: str | None = None
    lease_expires_at: datetime | None = None


class TurnReservationStore(Protocol):
    """Port: one durable, atomic turn reservation per admission."""

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome: ...
