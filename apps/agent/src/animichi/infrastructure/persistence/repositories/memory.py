"""Harness memory store on SQLModel/SQLAlchemy expressions (#995).

``SQLModelMemoryStore`` implements the ``pydantic_ai_harness`` memory
protocols (``MemoryStore`` + ``SearchableMemoryStore``) with the exact
semantics of the harness ``PostgresMemoryStore``: versioned compare-and-set
writes and deletes against ``agent_memory``, version generation through the
Atlas-provisioned ``agent_memory_versions`` sequence, and idempotent
operation receipts in ``agent_memory_operations``. Every statement is a
typed SQLAlchemy expression (raw-SQL policy, #999).

The receipt helpers live in ``_memory_receipts`` and the row-level flow
helpers in ``_memory_rows``; the repository is a thin composition of
read/write/search capability mixins (1-10-50).
"""

from __future__ import annotations

from pydantic_ai_harness.memory import (
    MemoryFile,
    MemoryMutation,
    MemoryOperation,
    MemorySearchResult,
)
from pydantic_ai_harness.memory._store import (
    validate_store_path,
    validate_store_prefix,
)

from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.repositories._memory_receipts import (
    _operation_row,
)
from animichi.infrastructure.persistence.repositories._memory_rows import (
    _delete,
    _list_paths,
    _read_row,
    _write,
)
from animichi.infrastructure.persistence.repositories._memory_search import (
    _search_empty,
    _search_result,
    _search_rows,
)


async def _read_memory(
    sessionmaker: AsyncSessionFactory, path: str, max_chars: int
) -> MemoryFile | None:
    "Read one memory file, or ``None`` when it does not exist."
    validate_store_path(path)
    if max_chars <= 0:
        raise ValueError("max_chars must be positive")
    async with sessionmaker() as session:
        return await _read_row(session, path, max_chars)


async def _operation_mutation(
    sessionmaker: AsyncSessionFactory, operation: MemoryOperation
) -> MemoryMutation | None:
    "The committed mutation of a prior operation, or ``None``."
    async with sessionmaker() as session:
        receipt = await _operation_row(session, operation)
    if receipt is None or not receipt.completed:
        return None
    return MemoryMutation(
        version=receipt.version,
        replayed=True,
        existed=receipt.existed,
    )


async def _write_memory(
    sessionmaker: AsyncSessionFactory,
    path: str,
    content: str,
    expected_version: str | None,
    operation: MemoryOperation | None,
) -> MemoryMutation:
    validate_store_path(path)
    async with sessionmaker() as session:
        async with session.begin():
            return await _write(session, path, content, expected_version, operation)


async def _delete_memory(
    sessionmaker: AsyncSessionFactory,
    path: str,
    expected_version: str | None,
    operation: MemoryOperation | None,
) -> MemoryMutation:
    validate_store_path(path)
    async with sessionmaker() as session:
        async with session.begin():
            return await _delete(session, path, expected_version, operation)


async def _list_memory_paths(
    sessionmaker: AsyncSessionFactory, prefix: str, limit: int
) -> list[str]:
    validate_store_prefix(prefix)
    if limit <= 0:
        raise ValueError("limit must be positive")
    async with sessionmaker() as session:
        return await _list_paths(session, prefix, limit)


async def _search_memory(
    sessionmaker: AsyncSessionFactory,
    prefix: str,
    query: str,
    limit: int,
    max_files: int,
    max_chars: int,
    max_file_chars: int,
) -> MemorySearchResult:
    validate_store_prefix(prefix)
    if _search_empty(query, limit, max_files, max_chars, max_file_chars):
        return MemorySearchResult(matches=[], scanned=0, truncated=False)
    async with sessionmaker() as session:
        rows = await _search_rows(session, prefix, max_files, max_file_chars)
    return _search_result(
        rows, query, limit, max_files, max_chars, prefix, max_file_chars
    )


class _MemoryReadMixin:
    """Read + receipt + list operations over one session factory."""

    _sessionmaker: AsyncSessionFactory

    async def read(self, path: str, *, max_chars: int) -> MemoryFile | None:
        return await _read_memory(self._sessionmaker, path, max_chars)

    async def get_operation(self, operation: MemoryOperation) -> MemoryMutation | None:
        return await _operation_mutation(self._sessionmaker, operation)

    async def list_paths(self, prefix: str = "", *, limit: int) -> list[str]:
        return await _list_memory_paths(self._sessionmaker, prefix, limit)


class _MemoryWriteMixin:
    """Versioned compare-and-set write and delete operations."""

    _sessionmaker: AsyncSessionFactory

    async def write(
        self,
        path: str,
        content: str,
        *,
        expected_version: str | None,
        operation: MemoryOperation | None = None,
    ) -> MemoryMutation:
        return await _write_memory(
            self._sessionmaker, path, content, expected_version, operation
        )

    async def delete(
        self,
        path: str,
        *,
        expected_version: str | None,
        operation: MemoryOperation | None = None,
    ) -> MemoryMutation:
        return await _delete_memory(
            self._sessionmaker, path, expected_version, operation
        )


class _MemorySearchMixin:
    """Prefix-scoped lexical search over one session factory."""

    _sessionmaker: AsyncSessionFactory

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
        return await _search_memory(
            self._sessionmaker,
            prefix,
            query,
            limit,
            max_files,
            max_chars,
            max_file_chars,
        )


class SQLModelMemoryStore(_MemorySearchMixin, _MemoryWriteMixin, _MemoryReadMixin):
    """The harness Memory store contract over the shared session factory."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker


__all__ = ["SQLModelMemoryStore"]
