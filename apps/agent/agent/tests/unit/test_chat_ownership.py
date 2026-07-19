"""Regression coverage for chat session ownership."""

from __future__ import annotations

from copy import deepcopy
from typing import TypeAlias
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from agent.agents.agent_result import AgentResult
from agent.agents.runtime_models import GreetingResponseModel
from agent.agents.session_state import SessionState
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.interfaces.public_api import RuntimeAPI
from agent.tests.db_doubles import build_persistence_supabase_double
from agent.tests.unit.conftest_fastapi import async_client, build_app

SessionSnapshot: TypeAlias = tuple[str, dict[str, object], int, int]


def _runtime(db: MagicMock, store: InMemorySessionStore) -> RuntimeAPI:
    return RuntimeAPI(db, session_store=store, model_http_client=MagicMock())


def _install_mock_pipeline(monkeypatch: pytest.MonkeyPatch) -> None:
    result = AgentResult(
        output=GreetingResponseModel(message="hello"),
        intent="greet_user",
        session_state=SessionState(),
    )
    monkeypatch.setattr(
        "agent.interfaces.public_api.run_animichi_agent",
        AsyncMock(return_value=result),
    )


class _ChatOwnershipHarness:
    def __init__(self) -> None:
        self.owners: dict[str, str] = {}
        self.store = InMemorySessionStore()
        self.db = build_persistence_supabase_double()
        self.db.session.check_session_owner = AsyncMock(side_effect=self._owns)
        self.db.session.upsert_conversation.side_effect = self._claim
        self.db.insert_message = AsyncMock()
        self.db.insert_request_log = AsyncMock()
        self.app, _ = build_app(runtime_api=_runtime(self.db, self.store), db=self.db)

    async def _owns(self, session_id: str, user_id: str) -> bool:
        return self.owners.get(session_id) == user_id

    async def _claim(self, session_id: str, user_id: str, _query: str) -> None:
        self.owners[session_id] = user_id

    async def post(self, user_id: str, session_id: str | None = None) -> httpx.Response:
        headers = {"X-User-Id": user_id}
        if session_id is not None:
            headers["X-Session-Id"] = session_id
        body = {
            "messages": [{"role": "user", "parts": [{"type": "text", "text": "hi"}]}]
        }
        async with async_client(self.app) as client:
            return await client.post("/v1/chat", json=body, headers=headers)

    async def create(self) -> str:
        response = await self.post("user-a")
        assert response.status_code == 200
        return next(iter(self.owners))

    async def snapshot(self, session_id: str) -> SessionSnapshot:
        state = await self.store.get(session_id)
        assert state is not None
        return (
            self.owners[session_id],
            deepcopy(state),
            self.db.session.upsert_conversation.await_count,
            self.db.insert_message.await_count,
        )


async def test_chat_rejects_cross_user_session_without_mutation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_mock_pipeline(monkeypatch)
    harness = _ChatOwnershipHarness()
    session_id = await harness.create()
    before = await harness.snapshot(session_id)
    response = await harness.post("user-b", session_id)
    assert (response.status_code, await harness.snapshot(session_id)) == (404, before)
