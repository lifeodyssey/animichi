"""Sanctioned fake lifecycle store for admission + TurnOutcome seam tests.

Models the durable single-winner semantics of the Postgres adapter in
process: a unique ``(session_id, turn_key)`` slot, revision bumping, digest
assertion, and the lease-guarded reserved/running/terminal transitions
(TURN-2 #949, TURN-3 #951). Exactly what the seam tests need without a
database — mirroring how the production store keeps the same invariants.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from unittest.mock import AsyncMock

from animichi.application.turn_admission import (
    AdmissionIdentity,
    AdmissionPolicy,
    AdmissionRequest,
    TurnAdmission,
)
from animichi.application.turn_admission_port import (
    AdmissionStatus,
    ReservationOutcome,
    ReserveRequest,
)
from animichi.application.turn_outcome_port import (
    SettleOutcome,
    SweepReport,
    TurnRef,
)

_ReservationStatus = Literal["reserved", "running", "completed", "failed"]
ReservationStatus = AdmissionStatus


@dataclass
class _Reservation:
    turn_key: str
    session_id: str | None
    revision: int
    digest: str | None
    status: _ReservationStatus
    owner: str | None
    lease_expires_at: datetime | None


def _digest(state: dict[str, object]) -> str:
    payload = json.dumps(state, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class FakeTurnReservationStore:
    """In-process store with the same unique-slot winner gate as Postgres."""

    def __init__(self, now: Callable[[], datetime] | None = None) -> None:
        self._now = now or (lambda: datetime.now(UTC))
        self.reservations: list[_Reservation] = []
        self.session_state: dict[str, dict[str, object]] = {}
        self.owners: dict[str, str] = {}
        self.dispatch_calls: list[tuple[str | None, str, str | None]] = []
        self.settle_calls: list[tuple[str | None, str, str | None, SettleOutcome]] = []
        self.release_calls: list[tuple[str | None, str, str | None]] = []
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
            return ReservationOutcome(
                status=_port_status(existing.status),
                session_id=session_id,
                revision=existing.revision,
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
                if raced is not None:
                    return ReservationOutcome(
                        status=_port_status(raced.status),
                        session_id=session_id,
                        revision=raced.revision,
                    )
            self.reservations.append(
                _Reservation(
                    turn_key=request.turn_key,
                    session_id=session_id,
                    revision=revision,
                    digest=request.session_digest,
                    status="reserved",
                    owner=request.owner,
                    lease_expires_at=request.lease_expires_at,
                )
            )
        return ReservationOutcome(
            status="admitted",
            session_id=session_id,
            revision=revision,
            owner=request.owner,
            lease_expires_at=request.lease_expires_at,
        )

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        reservation = self._by_turn_key(ref.session_id, ref.turn_key)
        self.dispatch_calls.append((ref.session_id, ref.turn_key, owner))
        if reservation is None or reservation.status != "reserved":
            return False
        if reservation.owner != owner or not self._lease_valid(reservation):
            return False
        reservation.status = "running"
        return True

    async def settle(self, ref: TurnRef, *, owner: str, outcome: SettleOutcome) -> bool:
        reservation = self._by_turn_key(ref.session_id, ref.turn_key)
        self.settle_calls.append((ref.session_id, ref.turn_key, owner, outcome))
        if reservation is None or reservation.status != "running":
            return False
        if reservation.owner != owner or not self._lease_valid(reservation):
            return False
        reservation.status = outcome
        return True

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        reservation = self._by_turn_key(ref.session_id, ref.turn_key)
        self.release_calls.append((ref.session_id, ref.turn_key, owner))
        if reservation is None or reservation.status != "reserved":
            return False
        if reservation.owner != owner:
            return False
        self.reservations.remove(reservation)
        return True

    async def sweep(self, *, now: datetime, owner: str, batch_size: int) -> SweepReport:
        async with self._lock():
            stale = [
                r
                for r in self.reservations
                if r.status in ("reserved", "running")
                and r.lease_expires_at is not None
                and r.lease_expires_at < now
            ][:batch_size]
            released = 0
            failed = 0
            for reservation in stale:
                if reservation.status == "reserved":
                    self.reservations.remove(reservation)
                    released += 1
                else:
                    reservation.status = "failed"
                    failed += 1
            return SweepReport(released=released, failed=failed)

    def seed_reservation(
        self,
        *,
        session_id: str | None,
        turn_key: str,
        status: _ReservationStatus = "reserved",
        owner: str = "seed",
        lease_expires_at: datetime | None = None,
    ) -> None:
        self.reservations.append(
            _Reservation(
                turn_key=turn_key,
                session_id=session_id,
                revision=1,
                digest=None,
                status=status,
                owner=owner,
                lease_expires_at=lease_expires_at,
            )
        )

    def seed_session(self, session_id: str, owner: str | None) -> None:
        self.session_state[session_id] = {"summary": "seed"}
        if owner is not None:
            self.owners[session_id] = owner

    def use_clock(self, now: Callable[[], datetime]) -> None:
        """Share the caller's clock so lease checks match TurnOutcome's sweep."""
        self._now = now

    def _lease_valid(self, reservation: _Reservation) -> bool:
        if reservation.lease_expires_at is None:
            return True
        return reservation.lease_expires_at > self._now()

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


def _port_status(stored: _ReservationStatus) -> AdmissionStatus:
    if stored == "completed":
        return "replay_completed"
    if stored == "failed":
        return "turn_failed"
    return "in_flight"


def lease_delta(seconds: int = 300) -> datetime:
    return datetime.now(UTC) + timedelta(seconds=seconds)


ANON_ID = "anon_0123456789abcdef0123456789abcdef"
ANON = AdmissionIdentity(user_id=ANON_ID, user_type="anonymous")
HUMAN = AdmissionIdentity(user_id="user-1", user_type="human")
MISMATCH_DIGEST = "0" * 64


def _request(
    *,
    identity: AdmissionIdentity = ANON,
    session_id: str | None = None,
    turn_key: str = "turn-1",
    expected_revision: int | None = None,
    session_digest: str | None = None,
    is_byok: bool = False,
) -> AdmissionRequest:
    return AdmissionRequest(
        identity=identity,
        session_id=session_id,
        turn_key=turn_key,
        expected_revision=expected_revision,
        session_digest=session_digest,
        is_byok=is_byok,
    )


def _admission(
    store: Any,
    *,
    policy: AdmissionPolicy | None = None,
    quota_count: int | None = None,
    spent: float = 0.0,
    now: Callable[[], datetime] | None = None,
) -> TurnAdmission:
    quota_repo = None
    if quota_count is not None:
        repo = AsyncMock()
        repo.count_for = AsyncMock(return_value=quota_count)
        repo.increment_and_count = AsyncMock(return_value=quota_count + 1)
        quota_repo = repo
    usage_repo = None
    if spent > 0 or policy is None or policy.budget_usd > 0:
        usage = AsyncMock()
        usage.total_cost_usd = AsyncMock(return_value=spent)
        usage.accumulate_usage = AsyncMock(return_value=None)
        usage_repo = usage
    return TurnAdmission(
        store=store,
        policy=policy or AdmissionPolicy(),
        usage_repo=usage_repo,
        anon_quota_repo=quota_repo,
        now=now,
    )
