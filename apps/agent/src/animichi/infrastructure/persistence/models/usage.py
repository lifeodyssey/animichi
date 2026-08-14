"""SQLModel mapping of ``public.daily_usage`` (#995).

Daily model-usage meter (issue #274 / S1.8). Natural key ``(usage_date,
scope)``; ``cost_usd`` is ``NUMERIC(14,6)`` in the Atlas migration, mapped as
``Numeric`` so binds and reads preserve the legacy Decimal/float contract.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Column, Date, DateTime, Numeric, Table, Text
from sqlmodel import Field, SQLModel


class DailyUsageModel(SQLModel, table=True):
    """Row of ``daily_usage`` — the scope-partitioned usage meter."""

    __tablename__ = "daily_usage"

    #: Annotation-only: the declarative metaclass assigns the Table at class
    #: creation; typing it lets generated statements reach the columns.
    __table__: Table

    usage_date: date = Field(sa_column=Column(Date, primary_key=True))
    scope: str = Field(sa_column=Column(Text, primary_key=True))
    requests: int = Field(sa_column=Column(BigInteger, nullable=False))
    input_tokens: int = Field(sa_column=Column(BigInteger, nullable=False))
    output_tokens: int = Field(sa_column=Column(BigInteger, nullable=False))
    cost_usd: Decimal = Field(sa_column=Column(Numeric(14, 6), nullable=False))
    updated_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )


#: Typed core-expression access to the mapped columns (see the models README:
#: SQLModel class attributes are pydantic-typed, so statements use the
#: underlying Table columns).
daily_usage_table: Table = DailyUsageModel.__table__
