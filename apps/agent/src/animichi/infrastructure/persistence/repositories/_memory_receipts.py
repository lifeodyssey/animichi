"""Operation-receipt helpers for the harness memory store (#995).

The write/delete compare-and-set flow reserves an idempotent receipt row in
``agent_memory_operations`` before mutating, so a replayed operation returns the
committed outcome instead of running twice. Split out of ``memory.py``
(1-10-50).
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic_ai_harness.memory import (
    MemoryMutation,
    MemoryOperation,
    MemoryOperationConflictError,
)
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.dml import ReturningInsert, Update
from sqlalchemy.sql.selectable import Select

from animichi.infrastructure.persistence.models import memory_operations_table


@dataclass(frozen=True)
class _OperationRow:
    """The receipt columns the store reads back from the operations table."""

    fingerprint: str
    version: str | None
    existed: bool
    completed: bool


def _operation_select(operation: MemoryOperation) -> Select:
    return select(
        memory_operations_table.c.fingerprint,
        memory_operations_table.c.version,
        memory_operations_table.c.existed,
        memory_operations_table.c.completed,
    ).where(memory_operations_table.c.id == operation.id)


def _check_fingerprint(operation: MemoryOperation, fingerprint: object) -> None:
    if str(fingerprint) == operation.fingerprint:
        return
    raise MemoryOperationConflictError(
        f"operation id {operation.id!r} was reused with different arguments"
    )


async def _operation_row(
    session: AsyncSession, operation: MemoryOperation
) -> _OperationRow | None:
    row = (await session.execute(_operation_select(operation))).first()
    if row is None:
        return None
    return _coerce_operation_row(row, operation)


def _coerce_operation_row(
    row: Row[tuple[object, ...]], operation: MemoryOperation
) -> _OperationRow:
    "Coerce one receipt row, validating its fingerprint replay guard."
    fingerprint, version, existed, completed = row
    _check_fingerprint(operation, fingerprint)
    return _OperationRow(
        fingerprint=str(fingerprint),
        version=str(version) if version is not None else None,
        existed=bool(existed),
        completed=bool(completed),
    )


def _reserve_insert(operation: MemoryOperation) -> ReturningInsert:
    return (
        pg_insert(memory_operations_table)
        .values(**_reserve_values(operation))
        .on_conflict_do_nothing()
        .returning(memory_operations_table.c.id)
    )


def _reserve_values(operation: MemoryOperation) -> dict[str, object]:
    "The pending receipt columns for one reserved operation."
    return {
        "id": operation.id,
        "fingerprint": operation.fingerprint,
        "version": None,
        "existed": False,
        "completed": False,
    }


async def _replay_receipt(
    session: AsyncSession, operation: MemoryOperation
) -> MemoryMutation:
    receipt = await _operation_row(session, operation)
    if receipt is None or not receipt.completed:
        raise RuntimeError(
            f"operation {operation.id!r} did not produce a committed receipt"
        )
    return MemoryMutation(
        version=receipt.version,
        replayed=True,
        existed=receipt.existed,
    )


async def _reserve_operation(
    session: AsyncSession, operation: MemoryOperation
) -> MemoryMutation | None:
    inserted = await session.execute(_reserve_insert(operation))
    if inserted.scalar_one_or_none() is not None:
        return None
    return await _replay_receipt(session, operation)


def _complete_update(operation: MemoryOperation, mutation: MemoryMutation) -> Update:
    return (
        update(memory_operations_table)
        .where(memory_operations_table.c.id == operation.id)
        .values(**_complete_values(mutation))
    )


def _complete_values(mutation: MemoryMutation) -> dict[str, object]:
    "The committed receipt columns for one completed operation."
    return {
        "version": mutation.version,
        "existed": mutation.existed,
        "completed": True,
    }


async def _complete_operation(
    session: AsyncSession,
    operation: MemoryOperation,
    mutation: MemoryMutation,
) -> None:
    await session.execute(_complete_update(operation, mutation))


__all__ = ["_operation_row", "_reserve_operation", "_complete_operation"]
