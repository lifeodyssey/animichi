"""SQLModel mapping of ``public.feedback`` (#995).

``id`` is a native database-generated UUIDv7 (the Animichi-owned entity key);
the Atlas migration owns the default. ``session_id`` stays text: it is the
external semantic key (anonymous identity or Neon Auth user id).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Table, Text, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlmodel import Field, SQLModel


class FeedbackModel(SQLModel, table=True):
    """Row of ``feedback`` — one rating on a completed turn."""

    __tablename__ = "feedback"

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
    session_id: str | None = Field(default=None, sa_column=Column(Text))
    query_text: str = Field(sa_column=Column(Text, nullable=False))
    intent: str | None = Field(default=None, sa_column=Column(Text))
    rating: str = Field(sa_column=Column(Text, nullable=False))
    comment: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )


#: Typed core-expression access to the mapped columns (see the models README:
#: SQLModel class attributes are pydantic-typed, so statements use the
#: underlying Table columns).
feedback_table: Table = FeedbackModel.__table__
