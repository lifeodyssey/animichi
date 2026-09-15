"""The FastAPI adapter's lifespan: startup instrumentation and shutdown teardown.

Startup configures observability only when a token asks for it, and shutdown
closes the session store and the database aggregate without letting either
failure swallow the other — a teardown that stops at the first failure leaks the
second resource. The adapter's route guards and error-code mapping are pinned in
``test_fastapi_route_errors.py`` and ``test_fastapi_error_mapping.py``.
"""

from __future__ import annotations

import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from animichi.config.settings import Settings
from animichi.interfaces.fastapi_service import _call_optional_async, _close_stores
from animichi.interfaces.routes._deps import setup_logfire


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


def test_setup_logfire_instruments_fastapi_and_httpx_when_token_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logfire_mock = MagicMock()
    monkeypatch.setenv("LOGFIRE_TOKEN", "test-token")
    monkeypatch.setitem(sys.modules, "logfire", logfire_mock)

    fake_app = object()
    setup_logfire(Settings(), app=fake_app)

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
    logfire_mock = MagicMock()
    monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)
    monkeypatch.setitem(sys.modules, "logfire", logfire_mock)

    setup_logfire(Settings(), app=object())

    logfire_mock.configure.assert_called_once()
    logfire_mock.instrument_pydantic_ai.assert_not_called()
    logfire_mock.instrument_fastapi.assert_not_called()
    logfire_mock.instrument_httpx.assert_not_called()
    logfire_mock.instrument_asyncpg.assert_not_called()
