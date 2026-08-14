"""SQLModel mappings of the harness memory tables (#995).

``agent_memory`` holds one versioned memory file per ``path``; the
``agent_memory_versions`` sequence (migration 20260809000003) owns version
generation exactly as the harness ``PostgresMemoryStore`` expected;
``agent_memory_operations`` records idempotent mutation receipts. All DDL is
Atlas-owned (20260809000003..06); these mappings only let typed SQLAlchemy
statements reach the columns.
"""

from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, Column, Table, Text
from sqlmodel import Field, SQLModel


class AgentMemoryModel(SQLModel, table=True):
    """Row of ``agent_memory`` — one versioned memory file."""

    __tablename__ = "agent_memory"

    #: Annotation-only: the declarative metaclass assigns the Table at class
    #: creation; typing it lets generated statements reach the columns.
    __table__: Table

    path: str = Field(sa_column=Column(Text, primary_key=True))
    content: str = Field(sa_column=Column(Text, nullable=False))
    version: int = Field(sa_column=Column(BigInteger, nullable=False))
    last_operation_id: str | None = Field(default=None, sa_column=Column(Text))


class AgentMemoryOperationModel(SQLModel, table=True):
    """Row of ``agent_memory_operations`` — one mutation receipt."""

    __tablename__ = "agent_memory_operations"

    #: Annotation-only: the declarative metaclass assigns the Table at class
    #: creation; typing it lets generated statements reach the columns.
    __table__: Table

    id: str = Field(sa_column=Column(Text, primary_key=True))
    fingerprint: str = Field(sa_column=Column(Text, nullable=False))
    version: str | None = Field(default=None, sa_column=Column(Text))
    existed: bool = Field(sa_column=Column(Boolean, nullable=False))
    completed: bool = Field(sa_column=Column(Boolean, nullable=False))


#: Typed core-expression access to the mapped columns.
memory_table: Table = AgentMemoryModel.__table__
memory_operations_table: Table = AgentMemoryOperationModel.__table__
