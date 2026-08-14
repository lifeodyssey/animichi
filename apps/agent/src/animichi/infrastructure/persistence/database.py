"""Async database lifecycle: one engine and session factory per application.

The FastAPI lifespan owns the single SQLAlchemy ``AsyncEngine`` and the
``async_sessionmaker`` built on it (#994). Repositories receive the session
factory and open short-lived ``AsyncSession`` instances per operation, so
every request's sessions are created and closed within the request's call
path; route handlers never hold a session across requests.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypeAlias
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

AsyncSessionFactory: TypeAlias = async_sessionmaker[AsyncSession]


@dataclass(frozen=True)
class DatabaseLifecycle:
    """One async engine plus its session factory, owned by the lifespan."""

    engine: AsyncEngine
    sessionmaker: AsyncSessionFactory

    async def close(self) -> None:
        """Dispose the engine, closing its pooled connections."""
        await self.engine.dispose()


def _asyncpg_url(dsn: str) -> str:
    """Libpq DSN -> SQLAlchemy async URL (asyncpg driver), query params stripped.

    ``postgres://`` is libpq shorthand for ``postgresql://``; SQLAlchemy only
    knows the long scheme, and asyncpg rejects unsupported libpq query
    parameters such as ``sslmode`` (the integration fixtures connect to local
    Docker targets without TLS).
    """
    scheme, _, rest = dsn.partition("://")
    normalized = "postgresql" if scheme == "postgres" else scheme
    bare = urlunsplit((normalized, *urlsplit(f"{normalized}://{rest}")[1:3], "", ""))
    return f"{normalized}+asyncpg://{bare.partition('://')[2]}"


def create_database_lifecycle(dsn: str) -> DatabaseLifecycle:
    """Build the engine + session factory for one application lifetime."""
    engine = create_async_engine(_asyncpg_url(dsn))
    return DatabaseLifecycle(
        engine=engine,
        sessionmaker=async_sessionmaker(engine, expire_on_commit=False),
    )
