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

from animichi.application.turn_outcome_port import SweepReport
from animichi.infrastructure.persistence.models import reservation_table
from animichi.infrastructure.persistence.repositories._turn_digest import (
    _FAILED,
    _RESERVED,
    _SWEEP_STATUSES,
)


class _TurnSweepMixin:
    """Private lease-sweep helpers shared by the turn reservation store."""

    async def _sweep(
        self,
        session: AsyncSession,
        now: datetime,
        owner: str,
        batch_size: int,
        lease_seconds: int,
    ) -> SweepReport:
        """Claim stale rows atomically with a skip-locked select, re-extending
        the lease per claim."""
        rows = (
            await session.execute(
                select(
                    reservation_table.c.id,
                    reservation_table.c.status,
                )
                .where(reservation_table.c.status.in_(_SWEEP_STATUSES))
                .where(reservation_table.c.lease_expires_at < now)
                .order_by(reservation_table.c.lease_expires_at)
                .limit(batch_size)
                .with_for_update(skip_locked=True)
            )
        ).all()
        claimed = [(row[0], str(row[1])) for row in rows]
        if not claimed:
            return SweepReport()
        await self._claim(session, claimed, owner, now, lease_seconds)
        released = 0
        for rid, status in claimed:
            released += int(await self._claim_row(session, rid, status))
        return SweepReport(released=released, failed=len(claimed) - released)

    async def _claim(
        self,
        session: AsyncSession,
        claimed: Sequence[tuple[object, str]],
        owner: str,
        now: datetime,
        lease_seconds: int,
    ) -> None:
        ids = [rid for rid, _status in claimed]
        await session.execute(
            update(reservation_table)
            .where(reservation_table.c.id.in_(ids))
            .values(
                lease_owner=owner,
                lease_expires_at=now + timedelta(seconds=lease_seconds),
                updated_at=func.now(),
            )
        )

    async def _claim_row(self, session: AsyncSession, rid: object, status: str) -> bool:
        """Settle one claimed row; ``True`` when it was released."""
        released = status == _RESERVED
        if released:
            await session.execute(
                delete(reservation_table).where(reservation_table.c.id == rid)
            )
        else:
            await session.execute(
                update(reservation_table)
                .where(reservation_table.c.id == rid)
                .values(status=_FAILED, updated_at=func.now())
            )
        return released


__all__ = ["_TurnSweepMixin"]
