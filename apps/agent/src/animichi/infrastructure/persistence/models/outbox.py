"""SQLModel mapping of ``public.turn_outbox_events`` (issue #1014, AC5).

The durable outbox records a settled turn's external non-transactional
effects (usage / quota / audit) so a process failure cannot lose or
double-apply them. ``id`` is a native database UUIDv7; (``turn_key``, ``kind``)
uniqueness makes enqueue idempotent, and ``delivered_at`` is the exactly-once
CAS marker cleared by the drain step.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Integer, Table, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlmodel import Field, SQLModel


class TurnOutboxModel(SQLModel, table=True):
    """Row of ``turn_outbox_events`` — one durable external-effect handoff."""

    __tablename__ = "turn_outbox_events"

    __table__: Table

    id: UUID | None = Field(
        default=None,
        sa_column=Column(
            PgUUID(as_uuid=True),
            primary_key=True,
            server_default=text("uuidv7()"),
        ),
    )
    session_id: str | None = Field(default=None, sa_column=Column(Text))
    turn_key: str = Field(sa_column=Column(Text, nullable=False))
    kind: str = Field(sa_column=Column(Text, nullable=False))
    payload: object | None = Field(default=None, sa_column=Column(JSONB))
    attempts: int = Field(sa_column=Column(Integer, nullable=False))
    delivered_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )


outbox_table: Table = TurnOutboxModel.__table__
