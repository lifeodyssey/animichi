"""Harness memory store on SQLModel/SQLAlchemy expressions (#995).

``SQLModelMemoryStore`` implements the ``pydantic_ai_harness`` memory
protocols (``MemoryStore`` + ``SearchableMemoryStore``) with the exact
semantics of the harness ``PostgresMemoryStore``: versioned compare-and-set
writes and deletes against ``agent_memory``, version generation through the
Atlas-provisioned ``agent_memory_versions`` sequence, and idempotent
operation receipts in ``agent_memory_operations``. Every statement is a
typed SQLAlchemy expression — this module never accepts or executes an
unchecked SQL string (raw-SQL policy, #999). Schema DDL stays Atlas-owned;
no runtime CREATE/ALTER runs here.

The operation-receipt helpers live in ``_memory_receipts`` (1-10-50).
"""

from __future__ import annotations

from pydantic_ai_harness.memory import (
    MemoryConflictError,
    MemoryFile,
    MemoryMutation,
    MemoryOperation,
    MemorySearchResult,
)
from pydantic_ai_harness.memory._store import (
    lexical_search,
    validate_store_path,
    validate_store_prefix,
)
from sqlalchemy import Sequence, Text, cast, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.models import (
    memory_table,
)
from animichi.infrastructure.persistence.repositories._memory_receipts import (
    MemoryReceiptMixin,
)

#: The Atlas-owned version sequence (migration 20260809000003); typed via
#: SQLAlchemy's ``Sequence`` construct, never a raw ``nextval('...')`` string.
_VERSION_SEQUENCE = Sequence("agent_memory_versions")


class SQLModelMemoryStore(MemoryReceiptMixin):
    """The harness Memory store contract over the shared session factory."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker

    async def read(self, path: str, *, max_chars: int) -> MemoryFile | None:
        validate_store_path(path)
        if max_chars <= 0:
            raise ValueError("max_chars must be positive")
        async with self._sessionmaker() as session:
            row = (
                await session.execute(
                    select(
                        func.left(memory_table.c.content, max_chars),
                        memory_table.c.version,
                        memory_table.c.last_operation_id,
                        func.length(memory_table.c.content),
                    ).where(memory_table.c.path == path)
                )
            ).first()
        if row is None:
            return None
        content, version, operation_id, length = row
        return MemoryFile(
            content=str(content),
            version=str(version),
            operation_id=str(operation_id) if operation_id is not None else None,
            truncated=int(str(length)) > max_chars,
        )

    async def get_operation(self, operation: MemoryOperation) -> MemoryMutation | None:
        async with self._sessionmaker() as session:
            receipt = await self._operation_row(session, operation)
        if receipt is None or not receipt.completed:
            return None
        return MemoryMutation(
            version=receipt.version,
            replayed=True,
            existed=receipt.existed,
        )

    async def write(
        self,
        path: str,
        content: str,
        *,
        expected_version: str | None,
        operation: MemoryOperation | None = None,
    ) -> MemoryMutation:
        validate_store_path(path)
        async with self._sessionmaker() as session:
            async with session.begin():
                if (
                    operation is not None
                    and (receipt := await self._reserve_operation(session, operation))
                    is not None
                ):
                    return receipt
                if expected_version is None:
                    inserted = await session.execute(
                        pg_insert(memory_table)
                        .values(
                            path=path,
                            content=content,
                            version=_VERSION_SEQUENCE.next_value(),
                            last_operation_id=operation.id if operation else None,
                        )
                        .on_conflict_do_nothing()
                        .returning(memory_table.c.version)
                    )
                    row = inserted.scalar_one_or_none()
                    existed = False
                else:
                    updated = await session.execute(
                        update(memory_table)
                        .where(memory_table.c.path == path)
                        .where(cast(memory_table.c.version, Text) == expected_version)
                        .values(
                            content=content,
                            version=_VERSION_SEQUENCE.next_value(),
                            last_operation_id=operation.id if operation else None,
                        )
                        .returning(memory_table.c.version)
                    )
                    row = updated.scalar_one_or_none()
                    existed = True
                if row is None:
                    raise MemoryConflictError(
                        f"memory path {path!r} changed before it could be written"
                    )
                mutation = MemoryMutation(
                    version=str(row), replayed=False, existed=existed
                )
                if operation is not None:
                    await self._complete_operation(session, operation, mutation)
                return mutation

    async def delete(
        self,
        path: str,
        *,
        expected_version: str | None,
        operation: MemoryOperation | None = None,
    ) -> MemoryMutation:
        validate_store_path(path)
        async with self._sessionmaker() as session:
            async with session.begin():
                if (
                    operation is not None
                    and (receipt := await self._reserve_operation(session, operation))
                    is not None
                ):
                    return receipt
                await session.execute(select(_VERSION_SEQUENCE.next_value()))
                if expected_version is None:
                    exists = await session.execute(
                        select(memory_table.c.path).where(memory_table.c.path == path)
                    )
                    if exists.scalar_one_or_none() is not None:
                        raise MemoryConflictError(
                            f"memory path {path!r} changed before it could be deleted"
                        )
                    existed = False
                else:
                    deleted = await session.execute(
                        delete(memory_table)
                        .where(memory_table.c.path == path)
                        .where(cast(memory_table.c.version, Text) == expected_version)
                        .returning(memory_table.c.version)
                    )
                    if deleted.scalar_one_or_none() is None:
                        raise MemoryConflictError(
                            f"memory path {path!r} changed before it could be deleted"
                        )
                    existed = True
                mutation = MemoryMutation(version=None, replayed=False, existed=existed)
                if operation is not None:
                    await self._complete_operation(session, operation, mutation)
                return mutation

    async def list_paths(self, prefix: str = "", *, limit: int) -> list[str]:
        validate_store_prefix(prefix)
        if limit <= 0:
            raise ValueError("limit must be positive")
        async with self._sessionmaker() as session:
            rows = (
                await session.execute(
                    select(memory_table.c.path)
                    .where(func.starts_with(memory_table.c.path, prefix))
                    .order_by(memory_table.c.path)
                    .limit(limit)
                )
            ).scalars()
        return [str(path) for path in rows]

    async def search(
        self,
        prefix: str,
        query: str,
        *,
        limit: int,
        max_files: int,
        max_chars: int,
        max_file_chars: int,
    ) -> MemorySearchResult:
        validate_store_prefix(prefix)
        if (
            not query.split()
            or limit <= 0
            or max_files <= 0
            or max_chars <= 0
            or max_file_chars <= 0
        ):
            return MemorySearchResult(matches=[], scanned=0, truncated=False)
        async with self._sessionmaker() as session:
            rows = (
                await session.execute(
                    select(
                        memory_table.c.path,
                        func.left(memory_table.c.content, max_file_chars),
                        func.length(memory_table.c.content),
                    )
                    .where(func.starts_with(memory_table.c.path, prefix))
                    .order_by(memory_table.c.path)
                    .limit(max_files + 1)
                )
            ).all()
        result = lexical_search(
            [(str(row[0]), str(row[1])) for row in rows],
            query,
            limit=limit,
            max_files=max_files,
            max_chars=max_chars,
            score_prefix=prefix,
        )
        return MemorySearchResult(
            matches=result.matches,
            scanned=result.scanned,
            truncated=result.truncated
            or any(int(str(row[2])) > max_file_chars for row in rows),
        )


__all__ = ["SQLModelMemoryStore"]
