"""Sanctioned fake :class:`TurnReservationStore` for admission seam tests.

Models the durable single-winner semantics of the Postgres adapter in
process: a unique ``(session_id, turn_key)`` slot, revision bumping, digest
assertion, and status transitions. Exactly what the seam tests need without a
database — mirroring how the production store keeps the same invariants.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from typing import Literal

from animichi.application.turn_admission_port import (
    AdmissionStatus,
    ReservationOutcome,
    ReserveRequest,
)

_ReservationStatus = Literal["in_flight", "completed"]
ReservationStatus = AdmissionStatus


@dataclass
class _Reservation:
    turn_key: str
    session_id: str | None
    revision: int
    digest: str | None
    status: _ReservationStatus


def _digest(state: dict[str, object]) -> str:
    payload = json.dumps(state, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class FakeTurnReservationStore:
    """In-process store with the same unique-slot winner gate as Postgres."""

    def __init__(self) -> None:
        self.reservations: list[_Reservation] = []
        self.session_state: dict[str, dict[str, object]] = {}
        self.owners: dict[str, str] = {}
        self.fail_calls: list[tuple[str | None, str]] = []
        self.complete_calls: list[tuple[str | None, str]] = []
        self._lock_instance = asyncio.Lock()

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome:
        session_id = request.session_id
        owner = self.owners.get(session_id) if session_id is not None else None
        if (
            owner is not None
            and request.identity_id is not None
            and owner != request.identity_id
        ):
            return ReservationOutcome(status="ownership", session_id=session_id)

        existing = self._by_turn_key(session_id, request.turn_key)
        if existing is not None:
            status: ReservationStatus = (
                "in_flight" if existing.status == "in_flight" else "replay_completed"
            )
            return ReservationOutcome(
                status=status, session_id=session_id, revision=existing.revision
            )

        current = max((r.revision for r in self._for_session(session_id)), default=0)
        if (
            request.expected_revision is not None
            and request.expected_revision != current
        ):
            return ReservationOutcome(status="stale_revision", session_id=session_id)
        state = self.session_state.get(session_id) if session_id is not None else None
        if (
            session_id is not None
            and request.session_digest is not None
            and state is not None
            and _digest(state) != request.session_digest
        ):
            return ReservationOutcome(status="digest_mismatch", session_id=session_id)

        revision = current + 1
        async with self._lock():
            if self._by_turn_key(session_id, request.turn_key) is not None:
                raced = self._by_turn_key(session_id, request.turn_key)
                if raced is not None and raced.status == "completed":
                    return ReservationOutcome(
                        status="replay_completed",
                        session_id=session_id,
                        revision=raced.revision,
                    )
                return ReservationOutcome(status="in_flight", session_id=session_id)
            self.reservations.append(
                _Reservation(
                    turn_key=request.turn_key,
                    session_id=session_id,
                    revision=revision,
                    digest=request.session_digest,
                    status="in_flight",
                )
            )
        return ReservationOutcome(
            status="admitted", session_id=session_id, revision=revision
        )

    async def complete(self, *, session_id: str | None, turn_key: str) -> None:
        reservation = self._by_turn_key(session_id, turn_key)
        if reservation is not None and reservation.status == "in_flight":
            reservation.status = "completed"
        self.complete_calls.append((session_id, turn_key))

    async def fail(self, *, session_id: str | None, turn_key: str) -> None:
        reservation = self._by_turn_key(session_id, turn_key)
        if reservation is not None:
            self.reservations.remove(reservation)
        self.fail_calls.append((session_id, turn_key))

    def seed_session(self, session_id: str, owner: str | None) -> None:
        self.session_state[session_id] = {"summary": "seed"}
        if owner is not None:
            self.owners[session_id] = owner

    def _for_session(self, session_id: str | None) -> list[_Reservation]:
        return [r for r in self.reservations if r.session_id == session_id]

    def _by_turn_key(
        self, session_id: str | None, turn_key: str
    ) -> _Reservation | None:
        for reservation in self.reservations:
            if (
                reservation.session_id == session_id
                and reservation.turn_key == turn_key
            ):
                return reservation
        return None

    def _lock(self) -> asyncio.Lock:
        return self._lock_instance
