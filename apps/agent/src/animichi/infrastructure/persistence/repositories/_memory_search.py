"""Lexical search helpers for the harness memory store (#995).

The prefix-scoped scan + lexical scoring that backs ``search()``, split
out of ``_memory_rows`` / ``memory.py`` (1-10-50).
"""

from __future__ import annotations

from pydantic_ai_harness.memory import MemorySearchResult
from pydantic_ai_harness.memory._store import lexical_search
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.selectable import Select

from animichi.infrastructure.persistence.models import memory_table


def _search_empty(
    query: str,
    limit: int,
    max_files: int,
    max_chars: int,
    max_file_chars: int,
) -> bool:
    if not query.split() or limit <= 0:
        return True
    if max_files <= 0 or max_chars <= 0 or max_file_chars <= 0:
        return True
    return False


def _search_select(prefix: str, max_files: int, max_file_chars: int) -> Select:
    return (
        select(
            memory_table.c.path,
            func.left(memory_table.c.content, max_file_chars),
            func.length(memory_table.c.content),
        )
        .where(func.starts_with(memory_table.c.path, prefix))
        .order_by(memory_table.c.path)
        .limit(max_files + 1)
    )


async def _search_rows(
    session: AsyncSession,
    prefix: str,
    max_files: int,
    max_file_chars: int,
) -> list[tuple[object, object, object]]:
    rows = await session.execute(
        _search_select(prefix, max_files, max_file_chars),
    )
    return [(row[0], row[1], row[2]) for row in rows.all()]


def _search_result(
    rows: list[tuple[object, object, object]],
    query: str,
    limit: int,
    max_files: int,
    max_chars: int,
    prefix: str,
    max_file_chars: int,
) -> MemorySearchResult:
    result = lexical_search(
        [(str(row[0]), str(row[1])) for row in rows],
        query,
        limit=limit,
        max_files=max_files,
        max_chars=max_chars,
        score_prefix=prefix,
    )
    return _compose_result(result, rows, max_file_chars)


def _compose_result(
    result: MemorySearchResult,
    rows: list[tuple[object, object, object]],
    max_file_chars: int,
) -> MemorySearchResult:
    "Attach the truncation flag for over-long scanned rows."
    truncated = result.truncated or any(
        int(str(row[2])) > max_file_chars for row in rows
    )
    return MemorySearchResult(
        matches=result.matches,
        scanned=result.scanned,
        truncated=truncated,
    )
