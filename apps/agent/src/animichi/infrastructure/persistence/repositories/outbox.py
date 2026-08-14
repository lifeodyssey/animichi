"""PostgreSQL-backed durable outbox on SQLModel/SQLAlchemy expressions (#1014, AC5).

The store records a settled turn's external effects durably: enqueue is
idempotent on (``turn_key``, ``kind``), drain claims a bounded batch of
undelivered rows (skip-locked), and mark_delivered is the exactly-once CAS.
"""

from __future__ import annotations

from datetime import datetime
from typing import cast

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.dml import ReturningInsert, Update
from sqlalchemy.sql.selectable import Select

from animichi.application.outbox_port import OutboxEntry, OutboxKind, OutboxRow
from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.models.outbox import outbox_table


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


def _undelivered_select(_now: datetime, batch_size: int) -> Select:
    del _now
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
        .limit(batch_size)
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


def _mark_success_for_statement(
    session_id: str | None,
    turn_key: str,
    kind: OutboxKind,
) -> Update:
    return (
        update(outbox_table)
        .where(
            outbox_table.c.session_id.is_not_distinct_from(session_id),
            outbox_table.c.turn_key == turn_key,
            outbox_table.c.kind == kind,
            outbox_table.c.delivered_at.is_(None),
        )
        .values(delivered_at=func.now(), updated_at=func.now())
    )


def _mark_failure_for_statement(
    session_id: str | None,
    turn_key: str,
    kind: OutboxKind,
) -> Update:
    return (
        update(outbox_table)
        .where(
            outbox_table.c.session_id.is_not_distinct_from(session_id),
            outbox_table.c.turn_key == turn_key,
            outbox_table.c.kind == kind,
            outbox_table.c.delivered_at.is_(None),
        )
        .values(attempts=outbox_table.c.attempts + 1, updated_at=func.now())
    )


async def _enqueue(session: AsyncSession, entry: OutboxEntry) -> bool:
    inserted = await session.execute(_enqueue_statement(entry))
    return inserted.scalar_one_or_none() is not None


async def _claim(session: AsyncSession, batch_size: int) -> list[OutboxRow]:
    selectable = _undelivered_select(datetime.fromtimestamp(0), batch_size)
    rows = (await session.execute(selectable)).all()
    return [_to_row(row) for row in rows]


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


async def _finish_for(
    session: AsyncSession,
    session_id: str | None,
    turn_key: str,
    kind: OutboxKind,
    *,
    success: bool,
) -> None:
    statement = (
        _mark_success_for_statement(session_id, turn_key, kind)
        if success
        else _mark_failure_for_statement(session_id, turn_key, kind)
    )
    await session.execute(statement)


class SQLModelOutboxStore:
    """Production adapter: one durable external-effect handoff per turn."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker

    async def enqueue(self, entry: OutboxEntry) -> bool:
        async with self._sessionmaker() as session:
            async with session.begin():
                return await _enqueue(session, entry)

    async def drain(self, *, now: datetime, batch_size: int) -> list[OutboxRow]:
        del now
        async with self._sessionmaker() as session:
            return await _claim(session, batch_size)

    async def mark_delivered(self, row_id: object, *, success: bool) -> bool:
        async with self._sessionmaker() as session:
            async with session.begin():
                await _finish(session, row_id, success=success)
                return True

    async def mark_delivered_for(
        self,
        session_id: str | None,
        turn_key: str,
        kind: OutboxKind,
        *,
        success: bool,
    ) -> bool:
        async with self._sessionmaker() as session:
            async with session.begin():
                await _finish_for(session, session_id, turn_key, kind, success=success)
                return True


__all__ = ["SQLModelOutboxStore"]
