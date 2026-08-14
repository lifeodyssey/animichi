"""Tests for CachedSessionStore (legacy name: CachedSessionStore) with
LRU write-through cache (#994: the store argument is the state-store adapter —
the SQLModel session repository on the migrated path)."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from animichi.infrastructure.session.cached_session_store import CachedSessionStore


@pytest.fixture()
def mock_db() -> AsyncMock:
    db = AsyncMock()
    db.get_session_state.return_value = None
    db.upsert_session_state.return_value = None
    db.delete_session_state.return_value = None
    return db


async def test_save_and_get(mock_db: AsyncMock) -> None:
    store = CachedSessionStore(mock_db)
    state: dict[str, object] = {"interactions": [], "summary": "test"}
    await store.set("s1", state)

    # Should be in cache — no DB read needed
    result = await store.get("s1")
    assert result == state

    # DB write was called
    mock_db.upsert_session_state.assert_called_once_with("s1", state)
    # DB read was NOT called (served from cache)
    mock_db.get_session_state.assert_not_called()


async def test_cache_miss_reads_db(mock_db: AsyncMock) -> None:
    mock_db.get_session_state.return_value = {"interactions": [1]}
    store = CachedSessionStore(mock_db)

    result = await store.get("s1")
    assert result == {"interactions": [1]}
    mock_db.get_session_state.assert_called_once_with("s1")


async def test_get_returns_none_on_miss(mock_db: AsyncMock) -> None:
    store = CachedSessionStore(mock_db)

    result = await store.get("nonexistent")
    assert result is None
    mock_db.get_session_state.assert_called_once_with("nonexistent")


async def test_cache_eviction(mock_db: AsyncMock) -> None:
    store = CachedSessionStore(mock_db, cache_size=2)
    await store.set("s1", {"a": 1})
    await store.set("s2", {"b": 2})
    await store.set("s3", {"c": 3})  # evicts s1

    assert "s1" not in store._cache
    assert "s2" in store._cache
    assert "s3" in store._cache


async def test_delete(mock_db: AsyncMock) -> None:
    store = CachedSessionStore(mock_db)
    await store.set("s1", {"x": 1})

    await store.delete("s1")

    assert "s1" not in store._cache
    mock_db.delete_session_state.assert_called_once_with("s1")


async def test_delete_nonexistent(mock_db: AsyncMock) -> None:
    """Deleting a session that doesn't exist should not raise."""
    store = CachedSessionStore(mock_db)
    await store.delete("nonexistent")
    mock_db.delete_session_state.assert_called_once_with("nonexistent")
