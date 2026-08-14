"""Operation-receipt helpers for the harness memory store (#995).

The write/delete compare-and-set flow reserves an idempotent receipt row in
``agent_memory_operations`` before mutating, so a replayed operation returns the
committed outcome instead of running twice. These are the private helpers that
implement that receipt machinery, split out of ``memory.py`` (1-10-50).
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
from sqlalchemy.ext.asyncio import AsyncSession

from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.models import memory_operations_table


@dataclass(frozen=True)
class _OperationRow:
    """The receipt columns the store reads back from the operations table."""

    fingerprint: str
    version: str | None
    existed: bool
    completed: bool


class MemoryReceiptMixin:
    """Private operation-receipt helpers shared by the memory store methods."""

    _sessionmaker: AsyncSessionFactory

    async def _operation_row(
        self, session: AsyncSession, operation: MemoryOperation
    ) -> _OperationRow | None:
        row = (
            await session.execute(
                select(
                    memory_operations_table.c.fingerprint,
                    memory_operations_table.c.version,
                    memory_operations_table.c.existed,
                    memory_operations_table.c.completed,
                ).where(memory_operations_table.c.id == operation.id)
            )
        ).first()
        if row is None:
            return None
        fingerprint, version, existed, completed = row
        if str(fingerprint) != operation.fingerprint:
            raise MemoryOperationConflictError(
                f"operation id {operation.id!r} was reused with different arguments"
            )
        return _OperationRow(
            fingerprint=str(fingerprint),
            version=str(version) if version is not None else None,
            existed=bool(existed),
            completed=bool(completed),
        )

    async def _reserve_operation(
        self, session: AsyncSession, operation: MemoryOperation
    ) -> MemoryMutation | None:
        inserted = await session.execute(
            pg_insert(memory_operations_table)
            .values(
                id=operation.id,
                fingerprint=operation.fingerprint,
                version=None,
                existed=False,
                completed=False,
            )
            .on_conflict_do_nothing()
            .returning(memory_operations_table.c.id)
        )
        if inserted.scalar_one_or_none() is not None:
            return None
        receipt = await self._operation_row(session, operation)
        if receipt is None or not receipt.completed:
            raise RuntimeError(
                f"operation {operation.id!r} did not produce a committed receipt"
            )
        return MemoryMutation(
            version=receipt.version,
            replayed=True,
            existed=receipt.existed,
        )

    async def _complete_operation(
        self,
        session: AsyncSession,
        operation: MemoryOperation,
        mutation: MemoryMutation,
    ) -> None:
        await session.execute(
            update(memory_operations_table)
            .where(memory_operations_table.c.id == operation.id)
            .values(
                version=mutation.version,
                existed=mutation.existed,
                completed=True,
            )
        )


__all__ = ["MemoryReceiptMixin"]
