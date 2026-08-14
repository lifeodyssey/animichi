"""Session-state statement + flow helpers (#994).

The create/load/upsert/delete/list/rename statements for the Session
aggregate, split out of ``session.py`` (1-10-50). Every statement is a
typed SQLAlchemy expression (raw-SQL policy, #999).
"""

from __future__ import annotations

from typing import cast

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.postgresql.dml import Insert as PgInsert
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.dml import Insert, ReturningUpdate
from sqlalchemy.sql.selectable import Select

from animichi.domain.repo_types import SessionListRow, SessionMetadata, SessionStateData
from animichi.infrastructure.persistence.models import session_table
from animichi.infrastructure.persistence.repositories._session_records import (
    SessionRecord,
    _as_metadata,
    _as_state,
    _as_text,
)


def _create_statement(
    session_id: str, user_id: str, first_query: str, session_state: SessionStateData
) -> Insert:
    return pg_insert(session_table).values(
        id=session_id,
        user_id=user_id,
        first_query=first_query,
        state=session_state,
    )


async def _create(
    session: AsyncSession,
    session_id: str,
    user_id: str,
    first_query: str,
    state: SessionStateData,
) -> None:
    await session.execute(
        _create_statement(session_id, user_id, first_query, state),
    )


def _load_select(session_id: str) -> Select:
    return select(
        session_table.c.id,
        session_table.c.user_id,
        session_table.c.title,
        session_table.c.first_query,
        session_table.c.state,
        session_table.c.metadata,
    ).where(session_table.c.id == session_id)


def _text_or_blank(value: object) -> str:
    "Coerce a nullable scalar to a string, blank when ``None``."
    return _as_text(value) if value is not None else ""


def _text_or_none(value: object) -> str | None:
    "Coerce a nullable scalar to a string, ``None`` when absent."
    return _as_text(value) if value is not None else None


def _build_record(row: Row[tuple[object, ...]]) -> SessionRecord:
    "Assemble one SessionRecord from a loaded row."
    return _coerce_record(row)


def _coerce_record(row: Row[tuple[object, ...]]) -> SessionRecord:
    return SessionRecord(
        session_id=_as_text(row.id),
        user_id=_text_or_blank(row.user_id),
        title=_text_or_none(row.title),
        first_query=_text_or_none(row.first_query),
        state=_as_state(row.state),
        metadata=_as_metadata(row.metadata),
    )


async def _load(session: AsyncSession, session_id: str) -> SessionRecord | None:
    row = (await session.execute(_load_select(session_id))).first()
    if row is None:
        return None
    return _build_record(row)


async def _get_state(session: AsyncSession, session_id: str) -> SessionStateData | None:
    result = await session.execute(
        select(session_table.c.state).where(session_table.c.id == session_id),
    )
    return _as_state(result.scalar_one_or_none())


def _upsert_state_statement(session_id: str, state: SessionStateData) -> Insert:
    statement = pg_insert(session_table).values(**_state_values(session_id, state))
    return statement.on_conflict_do_update(
        index_elements=[session_table.c.id],
        set_={
            "state": statement.excluded.state,
            "updated_at": func.now(),
        },
    )


def _state_values(session_id: str, state: SessionStateData) -> dict[str, object]:
    "The state-upsert columns for one session."
    return {
        "id": session_id,
        "state": state,
        "updated_at": func.now(),
    }


async def _upsert_state(
    session: AsyncSession, session_id: str, state: SessionStateData
) -> None:
    await session.execute(_upsert_state_statement(session_id, state))


async def _delete_state(session: AsyncSession, session_id: str) -> None:
    await session.execute(
        session_table.delete().where(session_table.c.id == session_id)
    )


def _upsert_statement(
    session_id: str,
    session_state: SessionStateData,
    metadata: SessionMetadata | None,
    user_id: str | None,
) -> Insert:
    statement = pg_insert(session_table).values(
        **_upsert_values(session_id, user_id, session_state, metadata)
    )
    return statement.on_conflict_do_update(
        index_elements=[session_table.c.id],
        set_=_upsert_set(statement),
    )


def _upsert_values(
    session_id: str,
    user_id: str | None,
    state: SessionStateData,
    metadata: SessionMetadata | None,
) -> dict[str, object]:
    "The insert columns for one full-session upsert."
    return {
        "id": session_id,
        "user_id": user_id,
        "state": state,
        "metadata": metadata,
    }


def _upsert_set(statement: PgInsert) -> dict[str, object]:
    "The conflict-patch columns for one full-session upsert."
    return {
        "state": statement.excluded.state,
        "metadata": _coalesce_metadata(statement),
        "user_id": _coalesce_user(statement),
    }


def _coalesce_metadata(statement: PgInsert) -> object:
    "Keep an existing metadata envelope unless the upsert carries a newer one."
    return func.coalesce(statement.excluded.metadata, session_table.c.metadata)


def _coalesce_user(statement: PgInsert) -> object:
    "Keep an existing owner unless the upsert carries a newer one."
    return func.coalesce(statement.excluded.user_id, session_table.c.user_id)


async def _upsert(
    session: AsyncSession,
    session_id: str,
    session_state: SessionStateData,
    metadata: SessionMetadata | None,
    user_id: str | None,
) -> None:
    await session.execute(
        _upsert_statement(session_id, session_state, metadata, user_id),
    )


def _list_columns() -> Select:
    "The session list columns read back in order."
    return select(
        session_table.c.id.label("session_id"),
        session_table.c.title,
        session_table.c.first_query,
        session_table.c.created_at,
        session_table.c.updated_at,
    )


def _list_statement(user_id: str, limit: int) -> Select:
    return (
        _list_columns()
        .where(session_table.c.user_id == user_id)
        .order_by(session_table.c.updated_at.desc())
        .limit(limit)
    )


async def _list(
    session: AsyncSession, user_id: str, limit: int
) -> list[SessionListRow]:
    rows = await session.execute(_list_statement(user_id, limit))
    return [cast(SessionListRow, dict(row._mapping)) for row in rows.all()]


def _title_statement(
    session_id: str, title: str, user_id: str | None
) -> ReturningUpdate:
    statement = (
        update(session_table)
        .where(session_table.c.id == session_id)
        .values(title=title, updated_at=func.now())
        .returning(session_table.c.id)
    )
    if user_id is not None:
        statement = statement.where(session_table.c.user_id == user_id)
    return statement


async def _update_title(
    session: AsyncSession,
    session_id: str,
    title: str,
    user_id: str | None,
) -> bool:
    result = await session.execute(
        _title_statement(session_id, title, user_id),
    )
    return result.scalar_one_or_none() is not None
