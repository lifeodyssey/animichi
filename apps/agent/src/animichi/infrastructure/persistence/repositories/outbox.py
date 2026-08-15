"""PostgreSQL-backed durable outbox on SQLModel/SQLAlchemy expressions (#1014, AC5).

The store records a settled turn's external effects durably: enqueue is
idempotent on (``turn_key``, ``kind``); ``process_undelivered`` applies each
undelivered row's effect and marks it delivered in ONE transaction per row,
so a crash cannot double-apply a non-idempotent effect (exactly-once, AC5).
"""

from __future__ import annotations

from datetime import datetime
from typing import cast

import structlog
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.dml import ReturningInsert, Update
from sqlalchemy.sql.selectable import Select

from animichi.application.outbox_port import (
    OutboxApplier,
    OutboxEntry,
    OutboxKind,
    OutboxRow,
)
from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.models.outbox import outbox_table

logger = structlog.get_logger(__name__)


def _enqueue_statement(entry: OutboxEntry) -> ReturningInsert:
    return (
        pg_insert(outbox_table)
        .values(
            turn_key=entry.turn_key,
            kind=entry.kind,
            session_id=entry.session_id,
            payload=entry.payload if entry.payload is not None else None,
            attempts=0,
            created_at=func.now(),
            updated_at=func.now(),
        )
        .on_conflict_do_nothing()
        .returning(outbox_table.c.id)
    )


def _claim_select(limit: int) -> Select:
    return (
        select(
            outbox_table.c.id,
            outbox_table.c.session_id,
            outbox_table.c.turn_key,
            outbox_table.c.kind,
            outbox_table.c.payload,
        )
        .where(outbox_table.c.delivered_at.is_(None))
        .order_by(outbox_table.c.created_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )


def _mark_failure_statement(row_id: object) -> Update:
    return (
        update(outbox_table)
        .where(
            outbox_table.c.id == row_id,
            outbox_table.c.delivered_at.is_(None),
        )
        .values(attempts=outbox_table.c.attempts + 1, updated_at=func.now())
    )


def _mark_success_statement(row_id: object) -> Update:
    return (
        update(outbox_table)
        .where(
            outbox_table.c.id == row_id,
            outbox_table.c.delivered_at.is_(None),
        )
        .values(delivered_at=func.now(), updated_at=func.now())
    )


async def _enqueue(session: AsyncSession, entry: OutboxEntry) -> bool:
    inserted = await session.execute(_enqueue_statement(entry))
    return inserted.scalar_one_or_none() is not None


async def _claim_one(session: AsyncSession) -> OutboxRow | None:
    """Claim the oldest undelivered row, locked for this transaction (AC5)."""
    rows = (await session.execute(_claim_select(1))).all()
    return None if not rows else _to_row(rows[0])


RowTuple = tuple[object, str | None, str, str, object | None]


def _to_row(row: object) -> OutboxRow:
    rid, sid, tkey, kind, payload = cast(RowTuple, row)
    return OutboxRow(
        id=rid,
        session_id=sid,
        turn_key=tkey,
        kind=cast(OutboxKind, kind),
        payload=payload,
    )


async def _finish(session: AsyncSession, row_id: object, *, success: bool) -> None:
    statement = (
        _mark_success_statement(row_id) if success else _mark_failure_statement(row_id)
    )
    await session.execute(statement)


class SQLModelOutboxStore:
    """Production adapter: one durable external-effect handoff per turn (AC5)."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker

    async def enqueue(self, entry: OutboxEntry) -> bool:
        async with self._sessionmaker() as session:
            async with session.begin():
                return await _enqueue(session, entry)

    async def process_undelivered(
        self,
        *,
        now: datetime,
        batch_size: int,
        applier: OutboxApplier,
    ) -> int:
        """Apply up to ``batch_size`` undelivered rows; return deliveries made.

        Each row is claimed (FOR UPDATE SKIP LOCKED), applied, and marked
        delivered in ONE transaction. A crash before that commit rolls both
        back (row re-drains); a crash after it persists both (never re-applies).
        """
        del now
        delivered = 0
        for _ in range(batch_size):
            claimed, ok = await self._claim_and_apply(applier)
            if not claimed:
                break
            if ok:
                delivered += 1
        return delivered

    async def _claim_and_apply(self, applier: OutboxApplier) -> tuple[bool, bool]:
        """Claim + apply + mark one row in a single transaction; (claimed, ok)."""
        async with self._sessionmaker() as session:
            async with session.begin():
                row = await _claim_one(session)
                if row is None:
                    return (False, False)
                try:
                    success = await applier(session, row)
                except Exception:
                    logger.warning("outbox_apply_exception", exc_info=True)
                    return (True, False)
                await _finish(session, row.id, success=success)
                return (True, success)


__all__ = ["SQLModelOutboxStore"]
