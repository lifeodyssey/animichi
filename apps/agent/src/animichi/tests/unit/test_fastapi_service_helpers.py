"""Focused unit tests for FastAPI adapter helper paths.

These tests intentionally target the low-coverage branches in
`agent/interfaces/fastapi_service.py` so the full cutover keeps the
repository-wide coverage gate green.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from animichi.config.settings import Settings
from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.infrastructure.persistence.repositories.session import SessionRecord
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.fastapi_service import (
    _call_optional_async,
    _close_stores,
    _contains_json_invalid_error,
    _http_error_code,
    create_fastapi_app,
)
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.routes._deps import _require_db


def _aggregate_double() -> PersistenceRepos:
    """A real PersistenceRepos aggregate over mock sub-repositories."""
    return PersistenceRepos(
        sessionmaker=MagicMock(),
        session=MagicMock(),
        turn_reservation=MagicMock(),
        bangumi=MagicMock(),
        points=MagicMock(),
        usage=MagicMock(),
        anon_quota=MagicMock(),
        feedback=MagicMock(),
        memory=MagicMock(),
        outbox=MagicMock(),
    )


@pytest.fixture
def mock_db() -> PersistenceRepos:
    db = _aggregate_double()
    db.points.search_points_by_location = AsyncMock(return_value=[])
    db.session.list_sessions = AsyncMock(return_value=[])
    db.session.load = AsyncMock(
        return_value=SessionRecord(session_id="sess-1", user_id="user-1")
    )
    db.session.get_messages = AsyncMock(return_value=[])
    db.session.current_revision = AsyncMock(return_value=0)
    db.session.insert_message = AsyncMock()
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
    mock_db.session.load.return_value = SessionRecord(
        session_id="sess-1", user_id="someone-else"
    )
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


def _failing_close(events: list[str], tag: str, message: str) -> AsyncMock:
    """Record ``tag`` then raise, so the attempted close is observable."""

    def record_and_fail() -> None:
        events.append(tag)
        raise RuntimeError(message)

    return AsyncMock(side_effect=record_and_fail)


@pytest.mark.asyncio
async def test_close_stores_isolates_session_store_failure() -> None:
    """A failing session-store close must not skip the db close."""
    events: list[str] = []
    session_store = AsyncMock()
    session_store.close = _failing_close(events, "session", "session close failed")
    db = AsyncMock()
    db.close = AsyncMock(side_effect=lambda: events.append("db"))

    with pytest.raises(RuntimeError, match="session close failed"):
        await _close_stores(session_store, db)

    assert events == ["session", "db"]


@pytest.mark.asyncio
async def test_close_stores_closes_db_when_session_store_has_no_close() -> None:
    """A store without a close method still lets the db close run."""
    events: list[str] = []
    session_store = object()
    db = AsyncMock()
    db.close = AsyncMock(side_effect=lambda: events.append("db"))

    await _close_stores(session_store, db)

    assert events == ["db"]


def test_require_db_returns_aggregate_when_valid() -> None:
    db = _aggregate_double()
    assert _require_db(db) is db


def test_require_db_raises_500_when_not_an_aggregate() -> None:
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        _require_db(object())
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
