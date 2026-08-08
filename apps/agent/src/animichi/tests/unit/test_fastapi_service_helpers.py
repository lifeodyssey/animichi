"""Focused unit tests for FastAPI adapter helper paths.

These tests intentionally target the low-coverage branches in
`agent/interfaces/fastapi_service.py` so the full cutover keeps the
repository-wide coverage gate green.
"""

from __future__ import annotations

import asyncio
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from animichi.config.settings import Settings
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.infrastructure.supabase.client import SupabaseClient
from animichi.interfaces import fastapi_service
from animichi.interfaces.fastapi_service import (
    _call_optional_async,
    _close_runtime_resources,
    _contains_json_invalid_error,
    _http_error_code,
    create_fastapi_app,
)
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.routes._deps import _require_supabase


@pytest.fixture
def mock_db() -> MagicMock:
    db = MagicMock(spec=SupabaseClient)
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.points.search_points_by_location = AsyncMock(return_value=[])
    db.session.get_conversations = AsyncMock(return_value=[])
    db.session.get_conversation = AsyncMock(return_value={"user_id": "user-1"})
    db.messages.get_messages = AsyncMock(return_value=[])
    db.feedback.save_feedback = AsyncMock(return_value="feedback-1")
    return db


def test_root_endpoint_returns_service_info(mock_db: MagicMock) -> None:
    app = create_fastapi_app(
        runtime_api=RuntimeAPI(
            mock_db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
        ),
        settings=Settings(),
    )

    with TestClient(app) as client:
        response = client.get("/")

    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "animichi-runtime"
    assert body["endpoints"]["healthz"] == "/healthz"


def test_missing_user_header_returns_structured_invalid_request_error_on_conversations(
    mock_db: MagicMock,
) -> None:
    app = create_fastapi_app(
        runtime_api=RuntimeAPI(
            mock_db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
        ),
        settings=Settings(),
    )

    with TestClient(app) as client:
        response = client.get("/v1/conversations")

    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "invalid_request"
    assert body["error"]["message"] == "X-User-Id header required."


def test_messages_route_returns_structured_404_when_ownership_mismatch(
    mock_db: MagicMock,
) -> None:
    mock_db.session.get_conversation.return_value = {"user_id": "someone-else"}
    app = create_fastapi_app(
        runtime_api=RuntimeAPI(
            mock_db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
        ),
        settings=Settings(),
    )

    with TestClient(app) as client:
        response = client.get(
            "/v1/conversations/sess-1/messages",
            headers={"X-User-Id": "user-1"},
        )

    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "not_found"


def test_feedback_validation_rejects_blank_query_text(mock_db: MagicMock) -> None:
    app = create_fastapi_app(
        runtime_api=RuntimeAPI(
            mock_db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
        ),
        settings=Settings(),
    )

    with TestClient(app) as client:
        response = client.post(
            "/v1/feedback",
            json={"rating": "good", "query_text": "   "},
        )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "invalid_request"


def test_feedback_validation_rejects_invalid_rating(mock_db: MagicMock) -> None:
    app = create_fastapi_app(
        runtime_api=RuntimeAPI(
            mock_db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
        ),
        settings=Settings(),
    )

    with TestClient(app) as client:
        response = client.post(
            "/v1/feedback",
            json={"rating": "great", "query_text": "京吹"},
        )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "invalid_request"


def test_feedback_success_persists(mock_db: MagicMock) -> None:
    app = create_fastapi_app(
        runtime_api=RuntimeAPI(
            mock_db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
        ),
        settings=Settings(),
    )

    with TestClient(app) as client:
        response = client.post(
            "/v1/feedback",
            json={"rating": "good", "query_text": "京吹", "intent": "search_bangumi"},
        )

    assert response.status_code == 200
    assert response.json() == {"feedback_id": "feedback-1"}


def test_sse_stream_returns_structured_error_event_on_runtime_failure(
    mock_db: MagicMock,
) -> None:
    runtime_api = MagicMock()
    runtime_api.handle = AsyncMock(side_effect=RuntimeError("boom"))
    app = create_fastapi_app(runtime_api=runtime_api, settings=Settings())

    with TestClient(app) as client:
        with client.stream(
            "POST",
            "/v1/runtime/stream",
            json={"text": "京吹"},
            headers={"X-User-Id": "user-1"},
        ) as response:
            body = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: error" in body
    assert '"code": "internal_error"' in body


def test_http_error_code_maps_404() -> None:
    assert _http_error_code(404) == "not_found"


def test_http_error_code_maps_503_to_internal_error() -> None:
    assert _http_error_code(503) == "internal_error"


def test_contains_json_invalid_error_detects_json_invalid() -> None:
    errors_obj = [{"type": "json_invalid"}]
    assert _contains_json_invalid_error(errors_obj) is True


def test_contains_json_invalid_error_returns_false_for_other_types() -> None:
    errors_obj = [{"type": "missing"}]
    assert _contains_json_invalid_error(errors_obj) is False


@pytest.mark.asyncio
async def test_call_optional_async_awaits_async_method() -> None:
    target = SimpleNamespace(close=AsyncMock())
    await _call_optional_async(target, "close")
    target.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_call_optional_async_ignores_missing_method() -> None:
    target = SimpleNamespace()
    await _call_optional_async(target, "close")


def _closable_mock(events: list[str], tag: str, attr: str = "close") -> AsyncMock:
    """Build a mock whose close method records ``tag`` into ``events``."""
    mock = AsyncMock()
    setattr(mock, attr, AsyncMock(side_effect=lambda: events.append(tag)))
    return mock


def _failing_close(events: list[str], tag: str, message: str) -> AsyncMock:
    """Record ``tag`` then raise, so the attempted close is observable."""

    def record_and_fail() -> None:
        events.append(tag)
        raise RuntimeError(message)

    return AsyncMock(side_effect=record_and_fail)


def _close_stub_bundle(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[list[str], asyncio.Task[object], AsyncMock, AsyncMock, AsyncMock]:
    """Build _close_runtime_resources stubs recording close order."""
    events: list[str] = []
    catalog = _closable_mock(events, "catalog", "aclose")
    monkeypatch.setattr(
        fastapi_service,
        "aclose_geocoding_client",
        AsyncMock(side_effect=lambda: events.append("geocoding")),
    )
    session_store = _closable_mock(events, "session")
    db = _closable_mock(events, "db")
    connect_task = asyncio.create_task(asyncio.sleep(0))
    return events, connect_task, catalog, session_store, db


@pytest.mark.asyncio
async def test_close_runtime_resources_isolates_close_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failing session-store close must not skip the db close."""
    events, connect_task, catalog, session_store, db = _close_stub_bundle(monkeypatch)
    session_store.close = _failing_close(events, "session", "session close failed")

    with pytest.raises(RuntimeError, match="session close failed"):
        await _close_runtime_resources(connect_task, catalog, session_store, db)

    assert events == ["catalog", "geocoding", "session", "db"]


@pytest.mark.asyncio
async def test_close_runtime_resources_catalog_failure_still_closes_stores(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failing catalog close must not skip geocoding/session/db closes."""
    events, connect_task, catalog, session_store, db = _close_stub_bundle(monkeypatch)
    catalog.aclose = _failing_close(events, "catalog", "catalog close failed")

    with pytest.raises(RuntimeError, match="catalog close failed"):
        await _close_runtime_resources(connect_task, catalog, session_store, db)

    assert events == ["catalog", "geocoding", "session", "db"]


@staticmethod
def test_lifespan_startup_does_not_block_on_db_connect() -> None:
    """Issue #694: the pool connect runs in the background, not before yield.

    Startup completes while ``connect`` is still blocked (a hang here means
    the readiness probe regressed to waiting on the database), and shutdown
    still awaits the connect task.
    """
    release = threading.Event()

    async def slow_connect() -> None:
        await asyncio.to_thread(release.wait)

    db = MagicMock(spec=SupabaseClient)
    db.connect = slow_connect
    app = create_fastapi_app(
        db=db,
        session_store=InMemorySessionStore(),
        settings=Settings(),
    )
    with TestClient(app) as client:
        try:
            response = client.get("/healthz")
            assert response.status_code == 200
        finally:
            # Release the connect task before the TestClient exits and awaits
            # it, so a failing assertion cannot hang the shutdown await.
            release.set()


def test_require_supabase_returns_client_when_valid(mock_db: MagicMock) -> None:
    result = _require_supabase(mock_db)
    assert result is mock_db


def test_require_supabase_raises_500_when_not_supabase_client() -> None:
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        _require_supabase(object())
    assert exc_info.value.status_code == 500
    assert "Database client not available" in exc_info.value.detail


def test_setup_logfire_instruments_fastapi_and_httpx_when_token_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import sys
    from unittest.mock import MagicMock

    from animichi.interfaces.routes._deps import setup_logfire

    logfire_mock = MagicMock()
    monkeypatch.setenv("LOGFIRE_TOKEN", "test-token")
    monkeypatch.setitem(sys.modules, "logfire", logfire_mock)

    fake_app = object()
    settings = Settings()
    setup_logfire(settings, app=fake_app)

    logfire_mock.configure.assert_called_once()
    assert (
        logfire_mock.configure.call_args.kwargs["send_to_logfire"] == "if-token-present"
    )
    logfire_mock.instrument_pydantic_ai.assert_called_once()
    logfire_mock.instrument_fastapi.assert_called_once_with(fake_app)
    logfire_mock.instrument_httpx.assert_called_once()
    logfire_mock.instrument_asyncpg.assert_called_once()


def test_setup_logfire_configures_without_instrumenting_when_token_not_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import sys
    from unittest.mock import MagicMock

    from animichi.interfaces.routes._deps import setup_logfire

    logfire_mock = MagicMock()
    monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)
    monkeypatch.setitem(sys.modules, "logfire", logfire_mock)

    setup_logfire(Settings(), app=object())

    logfire_mock.configure.assert_called_once()
    logfire_mock.instrument_pydantic_ai.assert_not_called()
    logfire_mock.instrument_fastapi.assert_not_called()
    logfire_mock.instrument_httpx.assert_not_called()
    logfire_mock.instrument_asyncpg.assert_not_called()


class _DoneTaskStub(asyncio.Task[object]):
    """Minimal done-task stand-in exposing only what the callback reads."""

    def __init__(self, outcome: Exception | None) -> None:
        self._outcome = outcome

    def cancelled(self) -> bool:
        return False

    def exception(self) -> Exception | None:
        return self._outcome


def test_log_connect_failure_warns_when_background_connect_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    warning = MagicMock()
    monkeypatch.setattr(fastapi_service, "logger", SimpleNamespace(warning=warning))

    fastapi_service._log_connect_failure(_DoneTaskStub(RuntimeError("boom")))

    warning.assert_called_once()
    assert warning.call_args.kwargs["error"].args == ("boom",)


def test_log_connect_failure_is_silent_when_connect_succeeded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    warning = MagicMock()
    monkeypatch.setattr(fastapi_service, "logger", SimpleNamespace(warning=warning))

    fastapi_service._log_connect_failure(_DoneTaskStub(None))

    warning.assert_not_called()
