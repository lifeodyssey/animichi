"""SQLModel mapping of ``public.sessions`` (SESSION-3 #961).

``id`` is a semantic key, not an Animichi-owned surrogate: the trusted
anonymous identity (``anon_<hex>``) before login and the Neon Auth user id
after adoption (#992). It deliberately stays text while the owned entities
(messages, turn_reservations) use native database-generated UUIDv7.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Table, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class SessionModel(SQLModel, table=True):
    """Row of ``sessions`` — the sole Session aggregate root."""

    __tablename__ = "sessions"

    #: Annotation-only: the declarative metaclass assigns the Table at class
    #: creation; typing it lets generated statements reach the columns.
    __table__: Table

    id: str = Field(sa_column=Column(Text, primary_key=True))
    user_id: str | None = Field(default=None, sa_column=Column(Text))
    title: str | None = Field(default=None, sa_column=Column(Text))
    first_query: str | None = Field(default=None, sa_column=Column(Text))
    state: dict[str, object] = Field(sa_column=Column(JSONB, nullable=False))
    #: Mapped under ``metadata_``: ``metadata`` is reserved on declarative
    #: classes (the SQLModel registry), so the attribute is renamed while the
    #: physical column keeps its ``metadata`` name.
    metadata_: dict[str, object] | None = Field(
        default=None, sa_column=Column("metadata", JSONB)
    )
    lifecycle: str = Field(sa_column=Column(Text, nullable=False))
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    expires_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )


#: Typed core-expression access to the mapped columns (see the models README:
#: SQLModel class attributes are pydantic-typed, so statements use the
#: underlying Table columns).
session_table: Table = SessionModel.__table__
