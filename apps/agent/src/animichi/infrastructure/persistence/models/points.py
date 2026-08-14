"""SQLModel mapping of ``public.points`` (#995).

Read-only pilgrimage point mapping. ``location`` is a PostGIS ``geography``
column; PostGIS types and functions are constrained to
``infrastructure.persistence.expressions`` (#999 exception module).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Integer, Table, Text
from sqlmodel import Field, SQLModel

from animichi.infrastructure.persistence.expressions import Geography


class PointModel(SQLModel, table=True):
    """Row of ``points`` — one pilgrimage spot attached to a work."""

    __tablename__ = "points"

    #: Annotation-only: the declarative metaclass assigns the Table at class
    #: creation; typing it lets generated statements reach the columns.
    __table__: Table

    id: str = Field(sa_column=Column(Text, primary_key=True))
    bangumi_id: str | None = Field(default=None, sa_column=Column(Text))
    name: str = Field(sa_column=Column(Text, nullable=False))
    name_cn: str | None = Field(default=None, sa_column=Column(Text))
    latitude: float = Field(sa_column=Column(Float, nullable=False))
    longitude: float = Field(sa_column=Column(Float, nullable=False))
    location: object | None = Field(default=None, sa_column=Column(Geography))
    image: str | None = Field(default=None, sa_column=Column(Text))
    episode: int | None = Field(default=None, sa_column=Column(Integer))
    time_seconds: int = Field(sa_column=Column(Integer, nullable=False))
    scene_desc: str | None = Field(default=None, sa_column=Column(Text))
    origin: str | None = Field(default=None, sa_column=Column(Text))
    origin_url: str | None = Field(default=None, sa_column=Column(Text))
    city: str | None = Field(default=None, sa_column=Column(Text))
    created_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    updated_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )


#: Typed core-expression access to the mapped columns (see the models README:
#: SQLModel class attributes are pydantic-typed, so statements use the
#: underlying Table columns).
points_table: Table = PointModel.__table__
