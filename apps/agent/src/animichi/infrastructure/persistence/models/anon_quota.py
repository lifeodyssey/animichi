"""SQLModel mapping of ``public.anon_daily_message_count`` (#995).

Per-identity anonymous daily message counter (issue #282 / S1.10). The
natural key is the composite ``(usage_date, anon_id)`` — no Animichi-owned
surrogate — so both columns stay typed as declared in the Atlas migration.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import BigInteger, Column, Date, DateTime, Table, Text
from sqlmodel import Field, SQLModel


class AnonDailyMessageCountModel(SQLModel, table=True):
    """Row of ``anon_daily_message_count`` — the anon quota counter."""

    __tablename__ = "anon_daily_message_count"

    #: Annotation-only: the declarative metaclass assigns the Table at class
    #: creation; typing it lets generated statements reach the columns.
    __table__: Table

    usage_date: date = Field(sa_column=Column(Date, primary_key=True))
    anon_id: str = Field(sa_column=Column(Text, primary_key=True))
    message_count: int = Field(sa_column=Column(BigInteger, nullable=False))
    updated_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )


#: Typed core-expression access to the mapped columns (see the models README:
#: SQLModel class attributes are pydantic-typed, so statements use the
#: underlying Table columns).
anon_quota_table: Table = AnonDailyMessageCountModel.__table__
