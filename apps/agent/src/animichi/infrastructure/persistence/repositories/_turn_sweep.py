"""Lease-sweep implementation for the turn reservation store (#994).

Reclaims expired reservations atomically with a skip-locked select,
extending the lease per claim then releasing or failing stale rows. Split
out of ``turn_reservation.py`` (1-10-50).
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.dml import Delete, Update
from sqlalchemy.sql.selectable import Select

from animichi.application.turn_outcome_port import SweepReport
from animichi.infrastructure.persistence.models import reservation_table
from animichi.infrastructure.persistence.repositories._turn_digest import (
    _FAILED,
    _RESERVED,
    _SWEEP_STATUSES,
)


def _stale_select(now: datetime, batch_size: int) -> Select:
    return (
        select(reservation_table.c.id, reservation_table.c.status)
        .where(reservation_table.c.status.in_(_SWEEP_STATUSES))
        .where(reservation_table.c.lease_expires_at < now)
        .order_by(reservation_table.c.lease_expires_at)
        .limit(batch_size)
        .with_for_update(skip_locked=True)
    )


def _claim_update(
    claimed: Sequence[tuple[object, str]],
    owner: str,
    now: datetime,
    lease_seconds: int,
) -> Update:
    ids = [rid for rid, _status in claimed]
    return (
        update(reservation_table)
        .where(reservation_table.c.id.in_(ids))
        .values(
            lease_owner=owner,
            lease_expires_at=now + timedelta(seconds=lease_seconds),
            updated_at=func.now(),
        )
    )


def _release_row(rid: object) -> Delete:
    return delete(reservation_table).where(reservation_table.c.id == rid)


def _fail_row(rid: object) -> Update:
    return (
        update(reservation_table)
        .where(reservation_table.c.id == rid)
        .values(status=_FAILED, updated_at=func.now())
    )


async def _claim_row(session: AsyncSession, rid: object, status: str) -> bool:
    """Settle one claimed row; ``True`` when it was released."""
    released = status == _RESERVED
    statement = _release_row(rid) if released else _fail_row(rid)
    await session.execute(statement)
    return released


async def _claim_expired(
    session: AsyncSession, now: datetime, batch_size: int
) -> list[tuple[object, str]]:
    rows = (await session.execute(_stale_select(now, batch_size))).all()
    return [(row[0], str(row[1])) for row in rows]


async def _release_claimed(
    session: AsyncSession, claimed: Sequence[tuple[object, str]]
) -> int:
    released = 0
    for rid, status in claimed:
        released += int(await _claim_row(session, rid, status))
    return released


async def _sweep(
    session: AsyncSession,
    now: datetime,
    owner: str,
    batch_size: int,
    lease_seconds: int,
) -> SweepReport:
    """Claim stale rows atomically, then release or fail each claim."""
    claimed = await _claim_expired(session, now, batch_size)
    if not claimed:
        return SweepReport()
    await session.execute(_claim_update(claimed, owner, now, lease_seconds))
    released = await _release_claimed(session, claimed)
    return SweepReport(released=released, failed=len(claimed) - released)


__all__ = ["_sweep"]
