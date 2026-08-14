"""Tortoise ORM candidate adapter for the turn-reservation contract.

Uses only public Tortoise model, transaction (``in_transaction``), QuerySet
(``filter``/``order_by``/``limit``/``select_for_update``), and expression
(``F``, ``Max``, ``Coalesce``) APIs. Zero raw SQL strings.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from tortoise import Tortoise
from tortoise.exceptions import IntegrityError
from tortoise.functions import Coalesce, Max
from tortoise.transactions import in_transaction

from animichi.application.adopt_sessions import ADOPT_TURN_KEY_PREFIX
from animichi.application.turn_admission_port import (
    AdmissionStatus,
    ReservationOutcome,
    ReserveRequest,
)
from animichi.application.turn_outcome_port import SettleOutcome, SweepReport, TurnRef
from animichi.infrastructure.persistence.repositories.turn_reservation import (
    state_digest,
)
from animichi.tests.integration.orm_bakeoff.models_tortoise import (
    SessionTortoise,
    TurnReservationTortoise,
)

_RESERVED = "reserved"
_RUNNING = "running"
_FAILED = "failed"
_SWEEP_STATUSES = ("reserved", "running")


class _ReservationConflict(Exception):
    """The single-winner insert lost the unique-key race."""


def _port_status(stored: str) -> AdmissionStatus:
    """Map a stored row status to the port vocabulary (failed never replays)."""
    if stored == "completed":
        return "replay_completed"
    if stored == "failed":
        return "turn_failed"
    return "in_flight"


class TortoiseStore:
    """Tortoise ORM implementation of :class:`BakeoffTurnStore`."""

    @staticmethod
    async def connect(dsn: str) -> None:
        await Tortoise.init(
            db_url=dsn,
            modules={
                "models": ["animichi.tests.integration.orm_bakeoff.models_tortoise"]
            },
            use_tz=True,
            timezone="UTC",
        )

    @staticmethod
    async def close() -> None:
        await Tortoise.close_connections()

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome:
        if request.turn_key.startswith(ADOPT_TURN_KEY_PREFIX):
            return ReservationOutcome(status="in_flight", session_id=request.session_id)
        try:
            outcome = await self._try_reserve(request)
        except _ReservationConflict:
            outcome = None
        if outcome is not None:
            return outcome
        raced = await self._existing(request.session_id, request.turn_key)
        if raced is not None:
            return raced
        return ReservationOutcome(status="in_flight", session_id=request.session_id)

    async def _try_reserve(self, request: ReserveRequest) -> ReservationOutcome | None:
        """Admitted outcome, or None when the insert lost the unique-key race."""
        try:
            async with in_transaction():
                guarded = await self._guarded(request)
                if guarded is not None:
                    return guarded
                revision = (await self._current_revision(request.session_id)) + 1
                await TurnReservationTortoise.create(
                    session_id=request.session_id,
                    turn_key=request.turn_key,
                    payer=request.payer,
                    identity_id=request.identity_id,
                    revision=revision,
                    digest=request.session_digest,
                    status=_RESERVED,
                    lease_owner=request.owner,
                    lease_expires_at=request.lease_expires_at,
                )
                return ReservationOutcome(
                    status="admitted",
                    session_id=request.session_id,
                    revision=revision,
                    owner=request.owner,
                    lease_expires_at=request.lease_expires_at,
                )
        except IntegrityError as error:
            message = str(error)
            if "unique constraint" in message:
                raise _ReservationConflict from error
            raise

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        updated = await TurnReservationTortoise.filter(
            session_id=ref.session_id,
            turn_key=ref.turn_key,
            status=_RESERVED,
            lease_owner=owner,
            lease_expires_at__gt=datetime.now(UTC),
        ).update(status=_RUNNING, updated_at=datetime.now(UTC))
        return updated == 1

    async def settle(self, ref: TurnRef, *, owner: str, outcome: SettleOutcome) -> bool:
        updated = await TurnReservationTortoise.filter(
            session_id=ref.session_id,
            turn_key=ref.turn_key,
            status=_RUNNING,
            lease_owner=owner,
            lease_expires_at__gt=datetime.now(UTC),
        ).update(status=outcome, updated_at=datetime.now(UTC))
        return updated == 1

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        removed = await TurnReservationTortoise.filter(
            session_id=ref.session_id,
            turn_key=ref.turn_key,
            status=_RESERVED,
            lease_owner=owner,
        ).delete()
        return removed == 1

    async def sweep(
        self, *, now: datetime, owner: str, batch_size: int, lease_seconds: int
    ) -> SweepReport:
        async with in_transaction():
            claimed = (
                await TurnReservationTortoise.filter(
                    status__in=_SWEEP_STATUSES,
                    lease_expires_at__lt=now,
                )
                .order_by("lease_expires_at")
                .limit(batch_size)
                .select_for_update(skip_locked=True)
            )
            await self._claim(claimed, owner, now, lease_seconds)
            released = 0
            for row in claimed:
                released += int(await self._claim_row(row))
            return SweepReport(released=released, failed=len(claimed) - released)

    async def current_revision(self, session_id: str | None) -> int:
        return await self._current_revision(session_id)

    async def reserve_then_fail(self, request: ReserveRequest) -> None:
        """Bake-off probe: full reserve flow in one transaction, then abort."""
        async with in_transaction():
            await self._guarded(request)
            revision = (await self._current_revision(request.session_id)) + 1
            await TurnReservationTortoise.create(
                session_id=request.session_id,
                turn_key=request.turn_key,
                payer=request.payer,
                identity_id=request.identity_id,
                revision=revision,
                digest=request.session_digest,
                status=_RESERVED,
                lease_owner=request.owner,
                lease_expires_at=request.lease_expires_at,
            )
            raise RuntimeError("forced reserve abort")

    async def _guarded(self, request: ReserveRequest) -> ReservationOutcome | None:
        session_id = request.session_id
        if session_id is not None and not await self._ownership_ok(
            session_id, request.identity_id
        ):
            return ReservationOutcome(status="ownership", session_id=session_id)
        existing = await self._existing(session_id, request.turn_key)
        if existing is not None:
            return existing
        current = await self._current_revision(session_id)
        if (
            request.expected_revision is not None
            and request.expected_revision != current
        ):
            return ReservationOutcome(status="stale_revision", session_id=session_id)
        if session_id is not None and request.session_digest is not None:
            row = await SessionTortoise.filter(id=session_id).first()
            if row is not None and state_digest(row.state) != request.session_digest:
                return ReservationOutcome(
                    status="digest_mismatch", session_id=session_id
                )
        return None

    async def _ownership_ok(self, session_id: str, identity_id: str | None) -> bool:
        row = await SessionTortoise.filter(id=session_id).first()
        if row is None or row.user_id is None:
            return True
        return identity_id is not None and row.user_id == identity_id

    async def _existing(
        self, session_id: str | None, turn_key: str
    ) -> ReservationOutcome | None:
        row = await TurnReservationTortoise.filter(
            session_id=session_id, turn_key=turn_key
        ).first()
        if row is None:
            return None
        return ReservationOutcome(
            status=_port_status(row.status),
            session_id=session_id,
            revision=int(row.revision),
        )

    async def _current_revision(self, session_id: str | None) -> int:
        rows = (
            await TurnReservationTortoise.filter(session_id=session_id)
            .annotate(revision_max=Coalesce(Max("revision"), 0))
            .values_list("revision_max")
        )
        if not rows:
            return 0
        return int(rows[0][0])

    async def _claim(
        self,
        claimed: list[TurnReservationTortoise],
        owner: str,
        now: datetime,
        lease_seconds: int,
    ) -> None:
        ids = [row.id for row in claimed]
        await TurnReservationTortoise.filter(id__in=ids).update(
            lease_owner=owner,
            lease_expires_at=now + timedelta(seconds=lease_seconds),
            updated_at=now,
        )

    async def _claim_row(self, row: TurnReservationTortoise) -> bool:
        released = row.status == _RESERVED
        if released:
            await row.delete()
        else:
            await TurnReservationTortoise.filter(id=row.id).update(
                status=_FAILED, updated_at=datetime.now(UTC)
            )
        return released


__all__ = ["TortoiseStore"]
