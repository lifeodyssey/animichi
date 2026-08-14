"""Admission + lifecycle helper functions for the turn store (#994).

The single-winner insert, the ownership/revision/digest guards, and the
dispatch/settle/release statement builders live here as module-level
helpers, split out of ``turn_reservation.py`` (1-10-50). Every statement
is a typed SQLAlchemy expression — no raw SQL text (raw-SQL policy, #999).
"""

from __future__ import annotations

from sqlalchemy import ColumnElement, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.dml import Delete, ReturningDelete, ReturningInsert, ReturningUpdate
from sqlalchemy.sql.selectable import Select

from animichi.application.turn_admission_port import (
    ReservationOutcome,
    ReserveRequest,
)
from animichi.application.turn_outcome_port import SettleOutcome, TurnRef
from animichi.infrastructure.persistence.models import (
    reservation_table,
    session_table,
)
from animichi.infrastructure.persistence.repositories._turn_digest import (
    _KEEP_REVISIONS,
    _RESERVED,
    _RUNNING,
    _port_status,
    state_digest,
)


def _reserve_statement(
    request: ReserveRequest, revision: int, session_id: str | None
) -> ReturningInsert:
    return (
        pg_insert(reservation_table)
        .values(**_reserve_values(request, revision, session_id))
        .on_conflict_do_nothing()
        .returning(reservation_table.c.revision)
    )


def _reserve_identity(request: ReserveRequest) -> dict[str, object]:
    "The request-derived columns of one admitted reservation."
    return {
        "turn_key": request.turn_key,
        "payer": request.payer,
        "identity_id": request.identity_id,
        "digest": request.session_digest,
        "request_digest": request.request_digest,
        "lease_owner": request.owner,
    }


def _reserve_values(
    request: ReserveRequest, revision: int, session_id: str | None
) -> dict[str, object]:
    "The columns of one admitted turn reservation."
    values = _reserve_identity(request)
    values["session_id"] = session_id
    values["revision"] = revision
    values["status"] = _RESERVED
    values["lease_expires_at"] = request.lease_expires_at
    return values


def _prune_keep(session_id: str | None) -> Select:
    return (
        select(reservation_table.c.id)
        .where(
            reservation_table.c.session_id.is_not_distinct_from(session_id),
            reservation_table.c.status == "completed",
            ~reservation_table.c.turn_key.like("adopt:%"),
        )
        .order_by(reservation_table.c.revision.desc())
        .limit(_KEEP_REVISIONS)
    )


def _prune_statement(session_id: str | None) -> Delete:
    return delete(reservation_table).where(
        reservation_table.c.session_id.is_not_distinct_from(session_id),
        reservation_table.c.status == "completed",
        ~reservation_table.c.turn_key.like("adopt:%"),
        reservation_table.c.id.not_in(_prune_keep(session_id)),
    )


def _existing_select(
    session_id: str | None, turn_key: str, identity_id: str | None
) -> Select:
    return select(
        reservation_table.c.status,
        reservation_table.c.revision,
        reservation_table.c.request_digest,
        reservation_table.c.outcome_payload,
    ).where(
        reservation_table.c.session_id.is_not_distinct_from(session_id),
        reservation_table.c.turn_key == turn_key,
        reservation_table.c.identity_id.is_not_distinct_from(identity_id),
    )


def _dispatch_where(ref: TurnRef, owner: str) -> tuple[ColumnElement[bool], ...]:
    return (
        reservation_table.c.session_id.is_not_distinct_from(ref.session_id),
        reservation_table.c.turn_key == ref.turn_key,
        reservation_table.c.status == _RESERVED,
        reservation_table.c.lease_owner == owner,
        reservation_table.c.lease_expires_at > func.now(),
    )


def _settle_where(ref: TurnRef, owner: str) -> tuple[ColumnElement[bool], ...]:
    return (
        reservation_table.c.session_id.is_not_distinct_from(ref.session_id),
        reservation_table.c.turn_key == ref.turn_key,
        reservation_table.c.status == _RUNNING,
        reservation_table.c.lease_owner == owner,
        reservation_table.c.lease_expires_at > func.now(),
    )


def _release_where(ref: TurnRef, owner: str) -> tuple[ColumnElement[bool], ...]:
    return (
        reservation_table.c.session_id.is_not_distinct_from(ref.session_id),
        reservation_table.c.turn_key == ref.turn_key,
        reservation_table.c.status == _RESERVED,
        reservation_table.c.lease_owner == owner,
    )


def _dispatch_statement(ref: TurnRef, owner: str) -> ReturningUpdate:
    return (
        update(reservation_table)
        .where(*_dispatch_where(ref, owner))
        .values(status=_RUNNING, updated_at=func.now())
        .returning(reservation_table.c.id)
    )


def _settle_statement(
    ref: TurnRef,
    owner: str,
    outcome: SettleOutcome,
    *,
    outcome_payload: object | None = None,
) -> ReturningUpdate:
    values: dict[str, object] = {"status": outcome, "updated_at": func.now()}
    if outcome_payload is not None:
        values["outcome_payload"] = outcome_payload
    return (
        update(reservation_table)
        .where(*_settle_where(ref, owner))
        .values(**values)
        .returning(reservation_table.c.id)
    )


def _release_statement(ref: TurnRef, owner: str) -> ReturningDelete:
    return (
        delete(reservation_table)
        .where(*_release_where(ref, owner))
        .returning(reservation_table.c.id)
    )


async def _ownership_ok(
    session: AsyncSession, session_id: str, identity_id: str | None
) -> bool:
    result = await session.execute(
        select(session_table.c.user_id).where(session_table.c.id == session_id)
    )
    owner = result.scalar_one_or_none()
    if owner is None:
        return True
    return identity_id is not None and str(owner) == identity_id


async def _session_state(session: AsyncSession, session_id: str) -> object | None:
    result = await session.execute(
        select(session_table.c.state).where(session_table.c.id == session_id)
    )
    return result.scalar_one_or_none()


async def _existing(
    session: AsyncSession,
    session_id: str | None,
    turn_key: str,
    identity_id: str | None,
) -> ReservationOutcome | None:
    row = (
        await session.execute(_existing_select(session_id, turn_key, identity_id))
    ).first()
    if row is None:
        return None
    status, revision, request_digest, outcome_payload = row
    return ReservationOutcome(
        status=_port_status(str(status)),
        session_id=session_id,
        revision=int(revision),
        request_digest=(str(request_digest) if request_digest is not None else None),
        outcome_payload=outcome_payload,
    )


async def _current_revision(session: AsyncSession, session_id: str | None) -> int:
    result = await session.execute(
        select(func.coalesce(func.max(reservation_table.c.revision), 0)).where(
            reservation_table.c.session_id.is_not_distinct_from(session_id),
        )
    )
    return int(result.scalar_one())


async def _next_revision(session: AsyncSession, session_id: str | None) -> int:
    return (await _current_revision(session, session_id)) + 1


async def _prune(session: AsyncSession, session_id: str | None) -> None:
    """Replay-history pruning keeps `_KEEP_REVISIONS` recent COMPLETED
    turns; synthetic adoption markers are always excluded."""
    await session.execute(_prune_statement(session_id))


async def _ownership_gate(
    session: AsyncSession, request: ReserveRequest
) -> ReservationOutcome | None:
    session_id = request.session_id
    if session_id is None:
        return None
    if await _ownership_ok(session, session_id, request.identity_id):
        return None
    return ReservationOutcome(status="ownership", session_id=session_id)


async def _revision_gate(
    session: AsyncSession, request: ReserveRequest
) -> ReservationOutcome | None:
    session_id = request.session_id
    if request.expected_revision is None:
        return None
    if request.expected_revision == await _current_revision(session, session_id):
        return None
    return ReservationOutcome(status="stale_revision", session_id=session_id)


async def _digest_gate(
    session: AsyncSession, request: ReserveRequest
) -> ReservationOutcome | None:
    session_id = request.session_id
    if session_id is None or request.session_digest is None:
        return None
    stored = await _session_state(session, session_id)
    if stored is None or state_digest(stored) == request.session_digest:
        return None
    return ReservationOutcome(status="digest_mismatch", session_id=session_id)


async def _guard(
    session: AsyncSession, request: ReserveRequest
) -> ReservationOutcome | None:
    outcome = await _ownership_gate(session, request)
    if outcome is not None:
        return outcome
    outcome = await _existing(
        session, request.session_id, request.turn_key, request.identity_id
    )
    if outcome is not None:
        return outcome
    outcome = await _revision_gate(session, request)
    if outcome is not None:
        return outcome
    return await _digest_gate(session, request)


def _admitted_outcome(
    request: ReserveRequest, session_id: str | None, revision: int
) -> ReservationOutcome:
    return ReservationOutcome(
        status="admitted",
        session_id=session_id,
        revision=revision,
        owner=request.owner,
        lease_expires_at=request.lease_expires_at,
    )


async def _try_insert(
    session: AsyncSession, request: ReserveRequest, revision: int
) -> ReservationOutcome | None:
    statement = _reserve_statement(request, revision, request.session_id)
    inserted = await session.execute(statement)
    if inserted.scalar_one_or_none() is None:
        return None
    await _prune(session, request.session_id)
    return _admitted_outcome(request, request.session_id, revision)


async def _replay_or_inflight(
    session: AsyncSession, request: ReserveRequest
) -> ReservationOutcome:
    raced = await _existing(
        session, request.session_id, request.turn_key, request.identity_id
    )
    if raced is not None:
        return raced
    return ReservationOutcome(status="in_flight", session_id=request.session_id)


async def _admit(session: AsyncSession, request: ReserveRequest) -> ReservationOutcome:
    guarded = await _guard(session, request)
    if guarded is not None:
        return guarded
    session_id = request.session_id
    revision = await _next_revision(session, session_id)
    admitted = await _try_insert(session, request, revision)
    if admitted is not None:
        return admitted
    return await _replay_or_inflight(session, request)
