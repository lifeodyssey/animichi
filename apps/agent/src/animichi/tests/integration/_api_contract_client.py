"""The contract client over the real test-container database.

``test_api_contract_*`` asserts the request/response shape of every endpoint the
FastAPI adapter exposes, with ``RuntimeAPI`` mocked so only the HTTP contract is
exercised and the ``tc_db`` fixture as the real aggregate. The app and client
construction lives here once: ``contract_app`` replaces the production lifespan
with a no-op (the ASGI transport and the container's asyncpg pool would
otherwise mismatch event loops, so the state is set directly), and the seeding
and cleanup the conversation cases need live here too.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import MagicMock

import httpx
from fastapi import FastAPI
from sqlalchemy import delete

from animichi.config.settings import Settings
from animichi.infrastructure.persistence.models import (
    message_table,
    session_table,
)
from animichi.infrastructure.persistence.repositories.composite import PersistenceRepos
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.fastapi_service import create_fastapi_app
from animichi.interfaces.public_api import RuntimeAPI


def contract_app(
    *,
    db: PersistenceRepos | object,
    runtime_api: RuntimeAPI | MagicMock | None = None,
) -> FastAPI:
    """Build a FastAPI app pre-configured for testing, without its lifespan."""
    settings = Settings()
    resolved_api: RuntimeAPI | MagicMock = runtime_api or RuntimeAPI(
        db,
        session_store=InMemorySessionStore(),
        model_http_client=MagicMock(),
    )

    @asynccontextmanager
    async def _noop_lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield

    app = create_fastapi_app(runtime_api=resolved_api, settings=settings, db=db)
    # Replace production lifespan with no-op; set state directly
    app.router.lifespan_context = _noop_lifespan
    app.state.settings = settings
    app.state.runtime_api = resolved_api
    app.state.db_client = db
    return app


def contract_client(
    *,
    runtime_api: RuntimeAPI | MagicMock | None = None,
    db: PersistenceRepos | None = None,
) -> httpx.AsyncClient:
    if db is None:
        raise RuntimeError(
            "tc_db fixture required: contract_client() needs the PersistenceRepos "
            "aggregate. Pass the tc_db fixture as db= parameter."
        )
    transport = httpx.ASGITransport(app=contract_app(db=db, runtime_api=runtime_api))
    return httpx.AsyncClient(transport=transport, base_url="https://test")


async def seed_conversation(
    db: PersistenceRepos, session_id: str, user_id: str, first_query: str = "hi"
) -> None:
    """Insert a session row for tests that need one."""
    await db.session.create(session_id, user_id, first_query, {})


async def seed_message(
    db: PersistenceRepos, session_id: str, role: str = "user", content: str = "hi"
) -> None:
    """Insert a message row for tests that need one."""
    await db.session.insert_message(session_id, role, content)


async def cleanup_test_data(db: PersistenceRepos) -> None:
    """Remove test-inserted rows to preserve isolation."""
    async with db.sessionmaker() as session:
        async with session.begin():
            await session.execute(
                delete(message_table).where(message_table.c.session_id.like("sess-%"))
            )
            await session.execute(
                delete(session_table).where(session_table.c.id.like("sess-%"))
            )
