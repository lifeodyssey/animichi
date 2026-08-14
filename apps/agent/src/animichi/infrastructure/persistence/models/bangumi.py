"""SQLModel mapping of ``public.bangumi`` (#995).

Read-only catalog master mapping (the agent never writes catalog data,
#839): every statement in the repository selects, joins, or filters. The
``points_count`` column is a maintained counter on the row in this schema.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Integer, Table, Text
from sqlmodel import Field, SQLModel


class BangumiModel(SQLModel, table=True):
    """Row of ``bangumi`` — one anime work in the pilgrimage catalog."""

    __tablename__ = "bangumi"

    #: Annotation-only: the declarative metaclass assigns the Table at class
    #: creation; typing it lets generated statements reach the columns.
    __table__: Table

    id: str = Field(sa_column=Column(Text, primary_key=True))
    title: str = Field(sa_column=Column(Text, nullable=False))
    title_cn: str | None = Field(default=None, sa_column=Column(Text))
    cover_url: str | None = Field(default=None, sa_column=Column(Text))
    air_date: str | None = Field(default=None, sa_column=Column(Text))
    summary: str | None = Field(default=None, sa_column=Column(Text))
    eps_count: int | None = Field(default=None, sa_column=Column(Integer))
    rating: float | None = Field(default=None, sa_column=Column(Float))
    points_count: int = Field(sa_column=Column(Integer, nullable=False))
    primary_color: str | None = Field(default=None, sa_column=Column(Text))
    city: str | None = Field(default=None, sa_column=Column(Text))
    platform: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    updated_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )


#: Typed core-expression access to the mapped columns (see the models README:
#: SQLModel class attributes are pydantic-typed, so statements use the
#: underlying Table columns).
bangumi_table: Table = BangumiModel.__table__
