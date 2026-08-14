"""Unit tests for conversation persistence.

Split from ``test_public_api_persistence.py`` (#992 F5: keep every test file
at or under 200 lines).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from animichi.tests.unit.conftest_public_api import install_mock_pipeline


@pytest.fixture(autouse=True)
def _mock_pipeline(monkeypatch: pytest.MonkeyPatch) -> None:
    install_mock_pipeline(monkeypatch)


@pytest.fixture
def mock_db() -> MagicMock:
    db = MagicMock()
    db.points.search_points_by_location = AsyncMock(return_value=[])
    db.session.create = AsyncMock()
    db.session.upsert_session = AsyncMock()
    db.session.insert_message = AsyncMock()
    db.session.check_session_owner = AsyncMock(return_value=True)
    return db


class TestConversationPersistence:
    # TODO: re-enable when conversation history title generation is wired back
    # async def test_first_interaction_returns_fallback_title(self, mock_db):
    #     api = RuntimeAPI(mock_db, session_store=InMemorySessionStore(), model_http_client=MagicMock())
    #     response = await api.handle(PublicAPIRequest(text="京吹"), user_id="u1")
    #     assert response is not None
    #     assert response.generated_title == "京吹"

    async def test_does_not_schedule_title_generation_for_existing_session(
        self,
        mock_db: MagicMock,
    ) -> None:
        store = InMemorySessionStore()
        session_id = "session-1"
        await store.set(
            session_id,
            {
                "interactions": [
                    {
                        "text": "以前の会話",
                        "intent": "search_bangumi",
                        "status": "ok",
                        "success": True,
                        "created_at": "2026-04-02T10:00:00+00:00",
                        "context_delta": {},
                    }
                ],
                "route_history": [],
                "last_intent": "search_bangumi",
                "last_status": "ok",
                "last_message": "ok",
                "updated_at": "2026-04-02T10:00:00+00:00",
            },
        )

        with patch(
            "animichi.interfaces.persistence.asyncio.create_task"
        ) as create_task:
            api = RuntimeAPI(
                mock_db, session_store=store, model_http_client=MagicMock()
            )
            await api.handle(
                PublicAPIRequest(text="京吹", session_id=session_id),
                user_id="u1",
            )

        create_task.assert_not_called()


# TODO: re-enable when session compaction is wired back
class _DisabledTestCompactThresholdTrigger:
    async def test_handle_triggers_compact_when_session_reaches_threshold(
        self, mock_db: MagicMock
    ) -> None:
        from unittest.mock import patch

        store = InMemorySessionStore()
        session_id = "sess-trigger"
        await store.set(
            session_id,
            {
                "interactions": [
                    {
                        "text": f"q{i}",
                        "intent": "search_bangumi",
                        "status": "ok",
                        "success": True,
                        "created_at": "2026-04-01T00:00:00Z",
                        "context_delta": {},
                    }
                    for i in range(7)
                ],
                "route_history": [],
                "last_intent": "search_bangumi",
                "last_status": "ok",
                "last_message": "",
                "summary": None,
                "updated_at": "2026-04-01T00:00:00Z",
            },
        )
        scheduled: list[object] = []

        def _capture_task(coro: object) -> MagicMock:
            scheduled.append(coro)
            close = getattr(coro, "close", None)
            if callable(close):
                close()
            return MagicMock()

        with patch(
            "animichi.interfaces.persistence._spawn_background",
            side_effect=_capture_task,
        ):
            api = RuntimeAPI(
                mock_db, session_store=store, model_http_client=MagicMock()
            )
            await api.handle(
                PublicAPIRequest(text="京吹", session_id=session_id), user_id=None
            )

        assert len(scheduled) >= 1
