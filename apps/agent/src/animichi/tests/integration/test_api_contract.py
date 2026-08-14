"""Contract tests for the FastAPI service API endpoints.

These tests assert the request/response shape (status codes, required keys,
types) for every endpoint exposed by the FastAPI adapter.  They serve as a
safety net during the FastAPI cutover — DB is a real testcontainer PostgreSQL,
RuntimeAPI is mocked so we only verify HTTP contract.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import delete

from animichi.agents.agent_result import AgentResult, StepRecord
from animichi.agents.runtime_models import SearchResponseModel
from animichi.agents.session_state import ResultRef, SearchPayloadState, SessionState
from animichi.config.settings import Settings
from animichi.infrastructure.persistence.database import (
    create_database_lifecycle,
)
from animichi.infrastructure.persistence.models import (
    feedback_table,
    message_table,
    session_table,
)
from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.fastapi_service import create_fastapi_app
from animichi.interfaces.public_api import PublicAPIResponse, RuntimeAPI

# ── Helpers ──────────────────────────────────────────────────────────────────


def _canned_agent_result() -> AgentResult:
    """A minimal successful AgentResult for mocking RuntimeAPI.handle."""
    output = SearchResponseModel(message="Found 0 pilgrimage spots.")
    state = SessionState()
    state.store_search_result(
        ResultRef("search:test:1"),
        SearchPayloadState(kind="bangumi", row_count=0),
    )
    return AgentResult(
        output=output,
        intent="search_bangumi",
        session_state=state,
        steps=[
            StepRecord(
                tool="search_bangumi",
                is_success=True,
                data={"rows": [], "row_count": 0},
            )
        ],
    )


def _canned_public_response() -> PublicAPIResponse:
    return PublicAPIResponse(
        success=True,
        status="ok",
        intent="search_bangumi",
        session_id="sess-contract",
        message="Found 0 pilgrimage spots.",
        data={"results": {"rows": [], "row_count": 0}},
        ui={"component": "PilgrimageGrid"},
    )


def _build_test_app(
    *,
    db: PersistenceRepos | object,
    runtime_api: RuntimeAPI | MagicMock | None = None,
) -> FastAPI:
    """Build a FastAPI app pre-configured for testing.

    Bypasses the production lifespan by pre-setting app.state directly.
    This avoids event-loop mismatch between the ASGI transport and the
    testcontainer asyncpg pool.
    """
    settings = Settings()
    resolved_api: RuntimeAPI | MagicMock = runtime_api or RuntimeAPI(
        db,
        session_store=InMemorySessionStore(),
        model_http_client=MagicMock(),
    )

    @asynccontextmanager
    async def _noop_lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield

    app = create_fastapi_app(
        runtime_api=resolved_api,
        settings=settings,
        db=db,
    )
    # Replace production lifespan with no-op; set state directly
    app.router.lifespan_context = _noop_lifespan
    app.state.settings = settings
    app.state.runtime_api = resolved_api
    app.state.db_client = db
    return app


def _build_app(
    *,
    runtime_api: RuntimeAPI | MagicMock | None = None,
    db: PersistenceRepos | None = None,
) -> httpx.AsyncClient:
    if db is None:
        raise RuntimeError(
            "tc_db fixture required: _build_app() needs the PersistenceRepos "
            "aggregate. Pass the tc_db fixture as db= parameter."
        )
    app = _build_test_app(db=db, runtime_api=runtime_api)
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="https://test")


def _mock_runtime_api(
    db: PersistenceRepos, response: PublicAPIResponse | None = None
) -> MagicMock:
    """Return a MagicMock that quacks like RuntimeAPI.handle."""
    api = MagicMock(spec=RuntimeAPI)
    api.handle = AsyncMock(return_value=response or _canned_public_response())
    api._db = db
    api._session_store = InMemorySessionStore()
    return api


async def _seed_conversation(
    db: PersistenceRepos, session_id: str, user_id: str, first_query: str = "hi"
) -> None:
    """Insert a session row for tests that need one."""
    await db.session.create(session_id, user_id, first_query, {})


async def _seed_message(
    db: PersistenceRepos, session_id: str, role: str = "user", content: str = "hi"
) -> None:
    """Insert a message row for tests that need one."""
    await db.session.insert_message(session_id, role, content)


async def _cleanup_test_data(db: PersistenceRepos) -> None:
    """Remove test-inserted rows to preserve isolation."""
    async with db.sessionmaker() as session:
        async with session.begin():
            await session.execute(
                delete(message_table).where(message_table.c.session_id.like("sess-%"))
            )
            await session.execute(
                delete(session_table).where(session_table.c.id.like("sess-%"))
            )
            await session.execute(
                delete(feedback_table).where(
                    feedback_table.c.query_text.in_(["京吹", "test", "  "])
                )
            )


# ── GET /healthz ─────────────────────────────────────────────────────────────


class TestHealthz:
    async def test_returns_200(self, tc_db: PersistenceRepos) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.get("/healthz")
        assert resp.status_code == 200

    async def test_response_has_required_keys(self, tc_db: PersistenceRepos) -> None:
        async with _build_app(db=tc_db) as client:
            body = (await client.get("/healthz")).json()
        assert "status" in body
        assert "service" in body
        assert isinstance(body["status"], str)
        assert isinstance(body["service"], str)

    async def test_response_includes_optional_diagnostics(
        self, tc_db: PersistenceRepos
    ) -> None:
        async with _build_app(db=tc_db) as client:
            body = (await client.get("/healthz")).json()
        for key in ("app_env", "observability_enabled", "db_adapter", "session_store"):
            assert key in body


# ── GET / (root) ─────────────────────────────────────────────────────────────


class TestRoot:
    async def test_returns_200_with_service_info(self, tc_db: PersistenceRepos) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.get("/")
        assert resp.status_code == 200
        body = resp.json()
        assert "service" in body
        assert "endpoints" in body
        assert isinstance(body["endpoints"], dict)


# ── GET /v1/conversations ────────────────────────────────────────────────────


class TestConversations:
    async def test_returns_200_list(self, tc_db: PersistenceRepos) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.get(
                "/v1/conversations",
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)

    async def test_missing_user_header_returns_400_error_shape(
        self, tc_db: PersistenceRepos
    ) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.get("/v1/conversations")
        assert resp.status_code == 400
        body = resp.json()
        assert "error" in body
        assert "code" in body["error"]
        assert "message" in body["error"]


# ── GET /v1/conversations/{id}/messages ──────────────────────────────────────


class TestConversationMessages:
    async def test_returns_200_with_messages_key(self, tc_db: PersistenceRepos) -> None:
        await _seed_conversation(tc_db, "sess-msg-1", "user-1")
        await _seed_message(tc_db, "sess-msg-1", role="user", content="hi")
        try:
            async with _build_app(db=tc_db) as client:
                resp = await client.get(
                    "/v1/conversations/sess-msg-1/messages",
                    headers={"X-User-Id": "user-1"},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert "messages" in body
            assert isinstance(body["messages"], list)
        finally:
            await _cleanup_test_data(tc_db)

    async def test_ownership_mismatch_returns_404(
        self, tc_db: PersistenceRepos
    ) -> None:
        await _seed_conversation(tc_db, "sess-owned", "other-user")
        try:
            async with _build_app(db=tc_db) as client:
                resp = await client.get(
                    "/v1/conversations/sess-owned/messages",
                    headers={"X-User-Id": "user-1"},
                )
            assert resp.status_code == 404
            body = resp.json()
            assert body["error"]["code"] == "not_found"
        finally:
            await _cleanup_test_data(tc_db)

    async def test_missing_conversation_returns_404(
        self, tc_db: PersistenceRepos
    ) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.get(
                "/v1/conversations/sess-nonexistent/messages",
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 404


# ── PATCH /v1/conversations/{id} ─────────────────────────────────────────────


class TestConversationPatch:
    async def test_returns_200_on_success(self, tc_db: PersistenceRepos) -> None:
        await _seed_conversation(tc_db, "sess-patch-1", "user-1")
        try:
            async with _build_app(db=tc_db) as client:
                resp = await client.patch(
                    "/v1/conversations/sess-patch-1",
                    json={"title": "New title"},
                    headers={"X-User-Id": "user-1"},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert "ok" in body
        finally:
            await _cleanup_test_data(tc_db)

    async def test_blank_title_returns_422(self, tc_db: PersistenceRepos) -> None:
        await _seed_conversation(tc_db, "sess-patch-2", "user-1")
        try:
            async with _build_app(db=tc_db) as client:
                resp = await client.patch(
                    "/v1/conversations/sess-patch-2",
                    json={"title": "   "},
                    headers={"X-User-Id": "user-1"},
                )
            assert resp.status_code == 422
        finally:
            await _cleanup_test_data(tc_db)

    async def test_missing_user_header_returns_400(
        self, tc_db: PersistenceRepos
    ) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.patch(
                "/v1/conversations/sess-patch-3",
                json={"title": "hello"},
            )
        assert resp.status_code == 400


# ── POST /v1/feedback ────────────────────────────────────────────────────────


class TestFeedback:
    async def test_returns_200_with_feedback_id(self, tc_db: PersistenceRepos) -> None:
        try:
            async with _build_app(db=tc_db) as client:
                resp = await client.post(
                    "/v1/feedback",
                    json={"rating": "good", "query_text": "京吹"},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert "feedback_id" in body
            assert isinstance(body["feedback_id"], str)
        finally:
            await _cleanup_test_data(tc_db)

    async def test_blank_query_text_returns_422(self, tc_db: PersistenceRepos) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.post(
                "/v1/feedback",
                json={"rating": "good", "query_text": "  "},
            )
        assert resp.status_code == 422
        body = resp.json()
        assert body["error"]["code"] == "invalid_request"

    async def test_invalid_rating_returns_422(self, tc_db: PersistenceRepos) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.post(
                "/v1/feedback",
                json={"rating": "amazing", "query_text": "test"},
            )
        assert resp.status_code == 422

    async def test_invalid_json_returns_400(self, tc_db: PersistenceRepos) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.post(
                "/v1/feedback",
                content=b"not json!",
                headers={"Content-Type": "application/json"},
            )
        assert resp.status_code == 400
        body = resp.json()
        assert body["error"]["code"] == "invalid_json"


# ── Error shape contract ─────────────────────────────────────────────────────


class TestErrorShape:
    """All error responses must follow {error: {code, message}} shape."""

    _ERROR_CASES = [
        ("GET", "/v1/conversations", None, None, 400),
        ("POST", "/v1/feedback", {"rating": "good", "query_text": "  "}, None, 422),
    ]

    @pytest.mark.parametrize(
        ("method", "path", "json_body", "headers", "expected_status"),
        _ERROR_CASES,
        ids=[f"{m} {p}" for m, p, *_ in _ERROR_CASES],
    )
    async def test_error_responses_have_standard_shape(
        self,
        tc_db: PersistenceRepos,
        method: str,
        path: str,
        json_body: dict[str, object] | None,
        headers: dict[str, str] | None,
        expected_status: int,
    ) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.request(
                method, path, json=json_body, headers=headers or {}
            )
        assert resp.status_code == expected_status
        body = resp.json()
        assert "error" in body
        error = body["error"]
        assert "code" in error
        assert "message" in error
        assert isinstance(error["code"], str)
        assert isinstance(error["message"], str)


# ── DB connection failure ────────────────────────────────────────────────────


class TestDBConnectionFailure:
    """Verify that a broken DB connection raises a clear fixture error."""

    async def test_build_app_without_db_raises(self) -> None:
        with pytest.raises(RuntimeError, match="tc_db fixture required"):
            _build_app(db=None)

    async def test_unreachable_database_surfaces_error(self) -> None:
        """An aggregate over an unreachable database fails on DB operations."""
        lifecycle = create_database_lifecycle("postgresql://localhost:1/nonexistent")
        bad_client = PersistenceRepos.build(lifecycle.sessionmaker)
        app = _build_test_app(db=bad_client)
        # raise_app_exceptions=False lets FastAPI's exception handler
        # return the 500 response instead of re-raising in the test.
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport, base_url="https://test"
        ) as client:
            resp = await client.get(
                "/v1/conversations", headers={"X-User-Id": "user-1"}
            )
        # Should get a 500 error, not a silent success
        assert resp.status_code == 500
