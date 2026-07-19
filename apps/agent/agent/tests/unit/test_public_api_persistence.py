"""Unit tests for conversation persistence."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agent.agents.agent_result import AgentResult
from agent.agents.runtime_models import GreetingResponseModel
from agent.agents.session_state import SessionState
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.infrastructure.supabase.client import SupabaseClient
from agent.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from agent.tests.unit.conftest_public_api import (
    install_mock_pipeline,
    make_run_agent_stub,
)


@pytest.fixture(autouse=True)
def _mock_pipeline(monkeypatch: pytest.MonkeyPatch) -> None:
    install_mock_pipeline(monkeypatch)


@pytest.fixture
def mock_db() -> MagicMock:
    db = MagicMock(spec=SupabaseClient)
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.points.search_points_by_location = AsyncMock(return_value=[])
    db.session.upsert_session = AsyncMock()
    db.session.upsert_conversation = AsyncMock()
    db.session.check_session_owner = AsyncMock(return_value=True)
    db.session.update_conversation_title = AsyncMock()
    db.routes.save_route = AsyncMock(return_value="route-1")
    return db


class TestGreetingPersistence:
    async def test_greeting_uses_dedicated_stage_and_persists(self) -> None:
        output = GreetingResponseModel(
            message="こんにちは！聖地巡礼のお手伝いをします。"
        )
        result = AgentResult(
            output=output,
            intent="greet_user",
            session_state=SessionState(),
        )

        _fake = make_run_agent_stub(result)

        db = MagicMock()
        db.session.upsert_session = AsyncMock()
        db.session.upsert_conversation = AsyncMock()
        db.insert_request_log = AsyncMock()

        session_store = MagicMock()
        session_store.get = AsyncMock(return_value=None)
        session_store.set = AsyncMock()
        session_store.delete = AsyncMock()
        session_store.close = AsyncMock()

        with patch("agent.interfaces.public_api.run_animichi_agent", side_effect=_fake):
            api = RuntimeAPI(
                db=db, session_store=session_store, model_http_client=MagicMock()
            )
            response = await api.handle(PublicAPIRequest(text="hi"), user_id="u1")

        assert response.intent == "greet_user"
        assert response.session_id is not None
        assert response.session["interaction_count"] == 1
        assert response.route_history == []
        session_store.get.assert_not_awaited()
        session_store.set.assert_awaited_once()
        db.session.upsert_session.assert_awaited_once()
        db.session.upsert_conversation.assert_awaited_once()
        db.insert_request_log.assert_awaited_once()


class TestRuntimeAPISession:
    async def test_handle_creates_and_persists_session(
        self, mock_db: MagicMock
    ) -> None:
        store = InMemorySessionStore()
        api = RuntimeAPI(mock_db, session_store=store, model_http_client=MagicMock())

        response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.session_id is not None
        assert response.session["interaction_count"] == 1
        saved_state = await store.get(response.session_id)
        assert saved_state is not None
        assert saved_state["last_intent"] == "search_bangumi"
        mock_db.session.upsert_session.assert_awaited_once()

    async def test_handle_reuses_existing_session(self, mock_db: MagicMock) -> None:
        store = InMemorySessionStore()
        api = RuntimeAPI(mock_db, session_store=store, model_http_client=MagicMock())

        first = await api.handle(PublicAPIRequest(text="你好"))
        second = await api.handle(
            PublicAPIRequest(
                text="秒速5厘米的取景地在哪",
                session_id=first.session_id,
            )
        )

        assert second.session_id == first.session_id
        assert second.session["interaction_count"] == 2
        assert second.session["last_intent"] == "search_bangumi"


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

        with patch("agent.interfaces.persistence.asyncio.create_task") as create_task:
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
            "agent.interfaces.persistence._spawn_background",
            side_effect=_capture_task,
        ):
            api = RuntimeAPI(
                mock_db, session_store=store, model_http_client=MagicMock()
            )
            await api.handle(
                PublicAPIRequest(text="京吹", session_id=session_id), user_id=None
            )

        assert len(scheduled) >= 1
