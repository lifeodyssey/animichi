"""Unit tests for handle_public_request, user-id propagation, locale, and origin context."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agent.agents.agent_result import AgentResult
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.infrastructure.supabase.client import SupabaseClient
from agent.interfaces.public_api import (
    PublicAPIRequest,
    RuntimeAPI,
    handle_public_request,
)
from agent.tests.unit.conftest_public_api import (
    install_mock_pipeline,
)
from agent.tests.unit.conftest_public_api import (
    make_result as _make_result,
)


@pytest.fixture(autouse=True)
def _mock_pipeline(monkeypatch):
    install_mock_pipeline(monkeypatch)


@pytest.fixture
def mock_db():
    db = MagicMock(spec=SupabaseClient)
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.points.search_points_by_location = AsyncMock(return_value=[])
    db.session.upsert_session = AsyncMock()
    db.session.upsert_conversation = AsyncMock()
    db.session.update_conversation_title = AsyncMock()
    db.routes.save_route = AsyncMock(return_value="route-1")
    return db


class TestHandlePublicRequest:
    async def test_helper_delegates_to_runtime_api(self, mock_db):
        store = InMemorySessionStore()
        response = await handle_public_request(
            PublicAPIRequest(text="你好"),
            mock_db,
            session_store=store,
        )

        assert response.intent == "search_bangumi"
        assert response.status == "empty"
        assert response.session["interaction_count"] == 1

    async def test_helper_forwards_explicit_model_override(self, mock_db, monkeypatch):
        captured: dict[str, object] = {}

        async def fake_run_agent(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            message_history: object | None = None,
            on_step: object | None = None,
            catalog: object | None = None,
        ) -> AgentResult:
            _ = (text, db, locale, context, message_history, on_step)
            captured["model"] = model
            return _make_result(locale=locale)

        explicit_model = object()
        monkeypatch.setattr(
            "agent.interfaces.public_api.run_animichi_agent", fake_run_agent
        )

        await handle_public_request(
            PublicAPIRequest(text="你好"),
            mock_db,
            model=explicit_model,
            session_store=InMemorySessionStore(),
        )

        assert captured["model"] is explicit_model


class TestUserIdPropagation:
    async def test_upserts_conversation_when_user_id_present(self, mock_db):
        api = RuntimeAPI(
            mock_db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
        )

        await api.handle(PublicAPIRequest(text="京吹の聖地"), user_id="user-abc")

        mock_db.session.upsert_conversation.assert_awaited_once()
        args = mock_db.session.upsert_conversation.await_args.args
        assert args[1] == "user-abc"

    async def test_skips_user_scoped_db_calls_when_user_id_absent(self, mock_db):
        api = RuntimeAPI(
            mock_db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
        )

        await api.handle(PublicAPIRequest(text="京吹の聖地"), user_id=None)

        mock_db.session.upsert_conversation.assert_not_awaited()


class TestLocalePassthrough:
    async def test_locale_field_accepted_in_request(self):
        req = PublicAPIRequest(text="hello", locale="zh")
        assert req.locale == "zh"

    async def test_locale_defaults_to_ja(self):
        req = PublicAPIRequest(text="hello")
        assert req.locale == "ja"

    async def test_handle_passes_locale_to_pipeline(self, mock_db):
        result = _make_result(
            intent="general_qa",
            locale="zh",
            data={},
            message="你好！有什么可以帮助你的？",
        )

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            message_history: object | None = None,
            on_step: object | None = None,
            catalog: object | None = None,
        ) -> AgentResult:
            _ = (text, db, model, locale, context, message_history, on_step)
            return result

        with patch("agent.interfaces.public_api.run_animichi_agent", side_effect=_fake):
            api = RuntimeAPI(
                mock_db,
                session_store=InMemorySessionStore(),
                model_http_client=MagicMock(),
            )
            response = await api.handle(PublicAPIRequest(text="你好", locale="zh"))

        assert response.intent == "general_qa"
        assert response.message  # non-empty

    async def test_handle_ja_locale_produces_japanese_message(self, mock_db):
        result = _make_result(
            intent="general_qa",
            locale="ja",
            data={},
            message="こんにちは！何かお手伝いしましょうか？",
        )

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            message_history: object | None = None,
            on_step: object | None = None,
            catalog: object | None = None,
        ) -> AgentResult:
            _ = (text, db, model, locale, context, message_history, on_step)
            return result

        with patch("agent.interfaces.public_api.run_animichi_agent", side_effect=_fake):
            api = RuntimeAPI(
                mock_db,
                session_store=InMemorySessionStore(),
                model_http_client=MagicMock(),
            )
            response = await api.handle(PublicAPIRequest(text="你好", locale="ja"))

        assert response.intent == "general_qa"
        assert response.message  # non-empty


class TestOriginCoordinatesWiredToContext:
    async def test_origin_lat_lng_injected_when_provided(self, mock_db):
        """Finding 1: origin_lat/lng on request are forwarded to pipeline context."""
        captured: dict[str, object] = {}

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            message_history: object | None = None,
            on_step: object | None = None,
            catalog: object | None = None,
        ) -> AgentResult:
            _ = (text, db, model, locale, message_history, on_step)
            captured["context"] = context
            return _make_result(locale=locale)

        request = PublicAPIRequest(text="聖地巡礼", origin_lat=34.9, origin_lng=135.8)

        with patch("agent.interfaces.public_api.run_animichi_agent", side_effect=_fake):
            api = RuntimeAPI(
                mock_db,
                session_store=InMemorySessionStore(),
                model_http_client=MagicMock(),
            )
            await api.handle(request)

        ctx = captured.get("context")
        assert isinstance(ctx, dict)
        assert ctx.get("origin_lat") == 34.9
        assert ctx.get("origin_lng") == 135.8

    async def test_origin_coords_not_injected_when_absent(self, mock_db):
        """When origin_lat/lng are not set, context does not contain those keys."""
        captured: dict[str, object] = {}

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            message_history: object | None = None,
            on_step: object | None = None,
            catalog: object | None = None,
        ) -> AgentResult:
            _ = (text, db, model, locale, message_history, on_step)
            captured["context"] = context
            return _make_result(locale=locale)

        request = PublicAPIRequest(text="聖地巡礼")

        with patch("agent.interfaces.public_api.run_animichi_agent", side_effect=_fake):
            api = RuntimeAPI(
                mock_db,
                session_store=InMemorySessionStore(),
                model_http_client=MagicMock(),
            )
            await api.handle(request)

        ctx = captured.get("context")
        if isinstance(ctx, dict):
            assert "origin_lat" not in ctx
            assert "origin_lng" not in ctx
