"""Row-level helper functions for the harness memory store (#995).

The versioned compare-and-set read/write/delete/list/search statements and
their small flow steps, split out of ``memory.py`` (1-10-50). Receipt
handling lives in ``_memory_receipts``; every statement is a typed
SQLAlchemy expression (raw-SQL policy, #999).
"""

from __future__ import annotations

from pydantic_ai_harness.memory import (
    MemoryConflictError,
    MemoryFile,
    MemoryMutation,
    MemoryOperation,
)
from sqlalchemy import Sequence, Text, cast, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.dml import ReturningDelete, ReturningInsert, ReturningUpdate
from sqlalchemy.sql.selectable import Select

from animichi.infrastructure.persistence.models import memory_table
from animichi.infrastructure.persistence.repositories._memory_receipts import (
    _complete_operation,
    _reserve_operation,
)

#: The Atlas-owned version sequence (migration 20260809000003); construct
#: typed via SQLAlchemy, never a raw ``nextval(...)`` string.
_VERSION_SEQUENCE = Sequence("agent_memory_versions")


def _operation_id(operation: MemoryOperation | None) -> object:
    return operation.id if operation else None


def _read_select(path: str, max_chars: int) -> Select:
    return select(
        func.left(memory_table.c.content, max_chars),
        memory_table.c.version,
        memory_table.c.last_operation_id,
        func.length(memory_table.c.content),
    ).where(memory_table.c.path == path)


async def _read_row(
    session: AsyncSession, path: str, max_chars: int
) -> MemoryFile | None:
    row = (await session.execute(_read_select(path, max_chars))).first()
    if row is None:
        return None
    content, version, operation_id, length = row
    return MemoryFile(
        content=str(content),
        version=str(version),
        operation_id=(str(operation_id) if operation_id is not None else None),
        truncated=int(str(length)) > max_chars,
    )


def _insert_statement(
    path: str, content: str, operation: MemoryOperation | None
) -> ReturningInsert:
    return (
        pg_insert(memory_table)
        .values(**_insert_values(path, content, operation))
        .on_conflict_do_nothing()
        .returning(memory_table.c.version)
    )


def _insert_values(
    path: str, content: str, operation: MemoryOperation | None
) -> dict[str, object]:
    "The columns for one versioned memory insert."
    return {
        "path": path,
        "content": content,
        "version": _VERSION_SEQUENCE.next_value(),
        "last_operation_id": _operation_id(operation),
    }


def _update_statement(
    path: str,
    content: str,
    expected_version: str,
    operation: MemoryOperation | None,
) -> ReturningUpdate:
    return (
        update(memory_table)
        .where(memory_table.c.path == path)
        .where(cast(memory_table.c.version, Text) == expected_version)
        .values(**_update_values(path, content, operation))
        .returning(memory_table.c.version)
    )


def _update_values(
    path: str, content: str, operation: MemoryOperation | None
) -> dict[str, object]:
    "The versioned columns updated by compare-and-set."
    return {
        "content": content,
        "version": _VERSION_SEQUENCE.next_value(),
        "last_operation_id": _operation_id(operation),
    }


async def _first_receipt(
    session: AsyncSession, operation: MemoryOperation | None
) -> MemoryMutation | None:
    if operation is None:
        return None
    return await _reserve_operation(session, operation)


async def _insert_row(
    session: AsyncSession,
    path: str,
    content: str,
    operation: MemoryOperation | None,
) -> tuple[object | None, bool]:
    inserted = await session.execute(_insert_statement(path, content, operation))
    return inserted.scalar_one_or_none(), False


async def _update_row(
    session: AsyncSession,
    path: str,
    content: str,
    expected_version: str,
    operation: MemoryOperation | None,
) -> tuple[object | None, bool]:
    stmt = _update_statement(path, content, expected_version, operation)
    updated = await session.execute(stmt)
    return updated.scalar_one_or_none(), True


async def _upsert_row(
    session: AsyncSession,
    path: str,
    content: str,
    expected_version: str | None,
    operation: MemoryOperation | None,
) -> tuple[object | None, bool]:
    if expected_version is None:
        return await _insert_row(session, path, content, operation)
    return await _update_row(session, path, content, expected_version, operation)


def _conflict(value: str, action: str) -> MemoryConflictError:
    return MemoryConflictError(
        f"memory path {value!r} changed before it could be {action}"
    )


async def _write_mutation(
    session: AsyncSession,
    path: str,
    content: str,
    expected_version: str | None,
    operation: MemoryOperation | None,
) -> MemoryMutation:
    row, existed = await _upsert_row(
        session, path, content, expected_version, operation
    )
    if row is None:
        raise _conflict(path, "written")
    return MemoryMutation(version=str(row), replayed=False, existed=existed)


async def _complete_receipt(
    session: AsyncSession,
    operation: MemoryOperation | None,
    mutation: MemoryMutation,
) -> MemoryMutation:
    if operation is not None:
        await _complete_operation(session, operation, mutation)
    return mutation


async def _write(
    session: AsyncSession,
    path: str,
    content: str,
    expected_version: str | None,
    operation: MemoryOperation | None,
) -> MemoryMutation:
    receipt = await _first_receipt(session, operation)
    if receipt is not None:
        return receipt
    mutation = await _write_mutation(
        session, path, content, expected_version, operation
    )
    return await _complete_receipt(session, operation, mutation)


def _delete_statement(path: str, expected_version: str) -> ReturningDelete:
    return (
        delete(memory_table)
        .where(memory_table.c.path == path)
        .where(cast(memory_table.c.version, Text) == expected_version)
        .returning(memory_table.c.version)
    )


async def _path_exists(session: AsyncSession, path: str) -> bool:
    result = await session.execute(
        select(memory_table.c.path).where(memory_table.c.path == path)
    )
    return result.scalar_one_or_none() is not None


async def _delete_row(
    session: AsyncSession, path: str, expected_version: str | None
) -> bool | None:
    if expected_version is None:
        if await _path_exists(session, path):
            return None
        return False
    deleted = await session.execute(_delete_statement(path, expected_version))
    if deleted.scalar_one_or_none() is None:
        return None
    return True


async def _delete_mutation(
    session: AsyncSession, path: str, expected_version: str | None
) -> MemoryMutation:
    await session.execute(select(_VERSION_SEQUENCE.next_value()))
    existed = await _delete_row(session, path, expected_version)
    if existed is None:
        raise _conflict(path, "deleted")
    return MemoryMutation(version=None, replayed=False, existed=existed)


async def _delete(
    session: AsyncSession,
    path: str,
    expected_version: str | None,
    operation: MemoryOperation | None,
) -> MemoryMutation:
    receipt = await _first_receipt(session, operation)
    if receipt is not None:
        return receipt
    mutation = await _delete_mutation(session, path, expected_version)
    return await _complete_receipt(session, operation, mutation)


def _paths_select(prefix: str, limit: int) -> Select:
    return (
        select(memory_table.c.path)
        .where(func.starts_with(memory_table.c.path, prefix))
        .order_by(memory_table.c.path)
        .limit(limit)
    )


async def _list_paths(session: AsyncSession, prefix: str, limit: int) -> list[str]:
    rows = await session.execute(_paths_select(prefix, limit))
    return [str(path) for path in rows.scalars()]
