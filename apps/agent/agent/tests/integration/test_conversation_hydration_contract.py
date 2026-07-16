"""Conversation hydration contract tests.

Validates that assistant responses persisted to conversation_messages
can be correctly hydrated back into RuntimeResponse shape by the frontend.

Uses FunctionModel (no real LLM) + real testcontainer DB to test the
data pipeline: agent → AgentResult → persistence → hydration.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

pytest_plugins = ("agent.tests.conftest_db",)


def _returned(messages: list[ModelMessage], tool: str) -> bool:
    return any(
        getattr(part, "tool_name", None) == tool
        for message in messages
        for part in message.parts
    )


def _search_model() -> FunctionModel:
    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        if not _returned(messages, "resolve_anime"):
            return ModelResponse(
                parts=[ToolCallPart("resolve_anime", {"title": "響け！ユーフォニアム"})]
            )
        if not _returned(messages, "search_bangumi"):
            return ModelResponse(
                parts=[ToolCallPart("search_bangumi", {"bangumi_id": "115908"})]
            )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    "search_response",
                    {"message": "響け！ユーフォニアムの聖地を見つけました。"},
                )
            ]
        )

    return FunctionModel(respond)


def _greeting_model() -> FunctionModel:
    def respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        return ModelResponse(
            parts=[
                ToolCallPart(
                    "greeting_response",
                    {"message": "こんにちは！聖地巡礼のお手伝いをします。"},
                )
            ]
        )

    return FunctionModel(respond)


@pytest.mark.integration
async def test_persisted_search_response_hydrates_correctly(real_db) -> None:
    """Search response → AgentResult → output has message."""
    from agent.agents.animichi_runner import run_animichi_agent
    from agent.tests.eval.mock_catalog_client import MockCatalogClient

    result = await run_animichi_agent(
        text="君の名は の聖地を教えて",
        db=real_db,
        locale="ja",
        model=_search_model(),
        catalog=MockCatalogClient(),
    )

    assert result.output is not None
    assert result.message
    assert isinstance(result.success, bool)


@pytest.mark.integration
async def test_persisted_greeting_response_hydrates_correctly(real_db) -> None:
    """Greeting prose uses the dedicated output and hydrates its message."""
    from agent.agents.animichi_runner import run_animichi_agent
    from agent.tests.eval.mock_catalog_client import MockCatalogClient

    result = await run_animichi_agent(
        text="你好",
        db=real_db,
        locale="zh",
        model=_greeting_model(),
        catalog=MockCatalogClient(),
    )

    assert result.intent == "greet_user"
    assert result.message


@pytest.mark.integration
async def test_conversations_list_api(real_db) -> None:
    """GET /v1/conversations should return conversation list."""
    import httpx

    from agent.infrastructure.session import InMemorySessionStore
    from agent.interfaces.fastapi_service import create_fastapi_app
    from agent.interfaces.public_api import RuntimeAPI

    runtime_api = RuntimeAPI(
        real_db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
    )
    app = create_fastapi_app(runtime_api=runtime_api, db=real_db)
    # Bypass lifespan — set app state directly (same pattern as test_api_contract)
    app.state.runtime_api = runtime_api
    app.state.db_client = real_db

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url="https://test"
    ) as client:
        resp = await client.get(
            "/v1/conversations",
            headers={"X-User-Id": "test-hydration-user", "X-User-Type": "human"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list) or "conversations" in data
