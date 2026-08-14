"""SQLModel mapping of ``public.request_log`` (#995).

``id`` is a native database-generated UUIDv7; ``plan_steps`` is JSONB and
``plan_quality_score`` is ``real`` in the Atlas migration.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Float, Integer, Table, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlmodel import Field, SQLModel


class RequestLogModel(SQLModel, table=True):
    """Row of ``request_log`` — one audit record per processed turn."""

    __tablename__ = "request_log"

    #: Annotation-only: the declarative metaclass assigns the Table at class
    #: creation; typing it lets generated statements reach the columns.
    __table__: Table

    id: UUID = Field(
        sa_column=Column(
            PG_UUID,
            primary_key=True,
            server_default=text("uuidv7()"),
        ),
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    session_id: str | None = Field(default=None, sa_column=Column(Text))
    query_text: str = Field(sa_column=Column(Text, nullable=False))
    locale: str = Field(sa_column=Column(Text, nullable=False))
    plan_steps: list[str] | None = Field(default=None, sa_column=Column(JSONB))
    intent: str | None = Field(default=None, sa_column=Column(Text))
    status: str | None = Field(default=None, sa_column=Column(Text))
    latency_ms: int | None = Field(default=None, sa_column=Column(Integer))
    plan_quality_score: float | None = Field(default=None, sa_column=Column(Float))


#: Typed core-expression access to the mapped columns (see the models README:
#: SQLModel class attributes are pydantic-typed, so statements use the
#: underlying Table columns).
request_log_table: Table = RequestLogModel.__table__
