"""SQLModel mapping of ``public.messages`` (SESSION-3 #961, #992).

The ordered Session transcript. ``id`` is an Animichi-owned identity generated
by the database's native ``uuidv7()`` default; ordering is the
GetSessionHistory boundary contract (``created_at ASC``).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Table, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlmodel import Field, SQLModel

from animichi.domain.repo_types import ResponseData


class MessageModel(SQLModel, table=True):
    """Row of ``messages`` — one turn transcript entry under a Session."""

    __tablename__ = "messages"

    __table__: Table

    id: UUID | None = Field(
        default=None,
        sa_column=Column(
            PgUUID(as_uuid=True),
            primary_key=True,
            server_default=text("uuidv7()"),
        ),
    )
    session_id: str = Field(
        sa_column=Column(
            Text, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
        )
    )
    role: str = Field(sa_column=Column(Text, nullable=False))
    content: str = Field(sa_column=Column(Text, nullable=False))
    response_data: ResponseData | None = Field(default=None, sa_column=Column(JSONB))
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )


message_table: Table = MessageModel.__table__
