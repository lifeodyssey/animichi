"""Unit tests for conversation persistence."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from animichi.agents.agent_result import AgentResult
from animichi.agents.runtime_models import GreetingResponseModel
from animichi.agents.session_state import SessionState
from animichi.application.outbox import TurnOutbox
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.outbox_dispatch import (
    SettlementInputs,
    SettlementOutboxDispatcher,
)
from animichi.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from animichi.interfaces.usage_metering import UsagePrices
from animichi.tests.unit.conftest_public_api import (
    install_mock_pipeline,
    make_run_agent_stub,
)
from animichi.tests.unit.outbox_fakes import MemoryOutbox


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
        db.session.create = AsyncMock()
        db.session.upsert_session = AsyncMock()
        db.session.insert_message = AsyncMock()
        # #663: the real repo lives at `db.feedback`, not a flat
        # `db.insert_request_log` — that was the production bug. Settle enqueues
        # the audit row; the drain writes the request log (AC5).
        db.feedback.insert_request_log_on = AsyncMock()
        outbox = MemoryOutbox()
        db.outbox = outbox

        session_store = MagicMock()
        session_store.get = AsyncMock(return_value=None)
        session_store.set = AsyncMock()
        session_store.delete = AsyncMock()
        session_store.close = AsyncMock()

        with patch(
            "animichi.interfaces.public_api.run_animichi_agent", side_effect=_fake
        ):
            api = RuntimeAPI(
                db=db, session_store=session_store, model_http_client=MagicMock()
            )
            response = await api.handle(PublicAPIRequest(text="hi"), user_id="u1")
        await TurnOutbox(store=outbox).drain(
            SettlementOutboxDispatcher(
                SettlementInputs(
                    usage_repo=db.usage,
                    anon_quota_repo=None,
                    request_audit_repo=db.feedback,
                    messages_repo=db.session,
                    prices=UsagePrices(0.0, 0.0),
                )
            )
        )

        assert response.intent == "greet_user"
        assert response.session_id is not None
        assert response.session["interaction_count"] == 1
        assert response.route_history == []
        session_store.get.assert_not_awaited()
        session_store.set.assert_awaited_once()
        db.session.upsert_session.assert_awaited_once()
        db.session.insert_message.assert_awaited()
        db.feedback.insert_request_log_on.assert_awaited_once()


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


class TestSQLModelRepositoryInjection:
    """#994: the migrated path injects the SQLModel repositories; the db-client
    locator must not be consulted for the Session aggregate or the transcript."""

    @pytest.fixture
    def db_without_repos(self) -> MagicMock:
        db = MagicMock()
        db.session = None
        db.feedback = MagicMock()
        db.feedback.insert_request_log = AsyncMock()
        return db

    async def test_injected_session_repo_owns_persistence(
        self, db_without_repos: MagicMock
    ) -> None:
        repo = MagicMock()
        repo.create = AsyncMock()
        repo.upsert_session = AsyncMock()
        repo.insert_message = AsyncMock()

        with patch(
            "animichi.interfaces.public_api.run_animichi_agent",
            side_effect=make_run_agent_stub(
                AgentResult(
                    output=GreetingResponseModel(
                        message="こんにちは！聖地巡礼のお手伝いをします。"
                    ),
                    intent="greet_user",
                    session_state=SessionState(),
                )
            ),
        ):
            api = RuntimeAPI(
                db_without_repos,
                session_repo=repo,
                session_store=InMemorySessionStore(),
                model_http_client=MagicMock(),
            )
            response = await api.handle(PublicAPIRequest(text="hi"), user_id="u1")

        assert response.session_id is not None
        repo.upsert_session.assert_awaited_once()
        repo.insert_message.assert_awaited()

    async def test_messages_repo_resolves_to_the_injected_repo(
        self, db_without_repos: MagicMock
    ) -> None:
        repo = MagicMock()
        api = RuntimeAPI(
            db_without_repos,
            session_repo=repo,
            session_store=InMemorySessionStore(),
            model_http_client=MagicMock(),
        )

        messages_repo = api._messages_repo

        assert messages_repo is repo
        assert api._session_repo is repo
