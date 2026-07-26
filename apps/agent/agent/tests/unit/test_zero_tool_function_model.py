"""Plain FunctionModel coverage for runs that call no function tools."""

from __future__ import annotations

from collections.abc import Mapping
from unittest.mock import MagicMock

from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.agent_result import AgentResult
from agent.agents.animichi_runner import run_animichi_agent
from agent.agents.runtime_models import (
    ClarifyResponseModel,
    GreetingResponseModel,
    QAResponseModel,
)
from agent.agents.session_state import PendingClarification, SessionState
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def _greeting_model() -> FunctionModel:
    def respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        return ModelResponse(
            parts=[ToolCallPart("greeting_response", {"message": "Hello!"})]
        )

    return FunctionModel(respond)


def _qa_model() -> FunctionModel:
    def respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        return ModelResponse(
            parts=[ToolCallPart("qa_response", {"message": "Answer."})]
        )

    return FunctionModel(respond)


def _clarify_model() -> FunctionModel:
    def respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        payload = {
            "reason": "anime_not_found",
            "message": "Check the title.",
            "candidate_ids": [],
        }
        return ModelResponse(parts=[ToolCallPart("clarify_response", payload)])

    return FunctionModel(respond)


async def _run(model: FunctionModel) -> AgentResult:
    return await run_animichi_agent(
        text="hello",
        db=MagicMock(),
        locale="en",
        catalog=MockCatalogClient(),
        model=model,
    )


async def _run_with_context(
    model: FunctionModel, context: Mapping[str, object]
) -> AgentResult:
    return await run_animichi_agent(
        text="not real",
        db=MagicMock(),
        locale="en",
        catalog=MockCatalogClient(),
        model=model,
        context=dict(context),
    )


def _clarify_context() -> Mapping[str, object]:
    pending = PendingClarification(
        reason="anime_not_found", candidate_ids=[], revision=1
    )
    session = SessionState(pending_clarification=pending)
    return {"session_state_v2": session.model_dump(mode="json")}


async def test_plain_function_model_greeting_needs_no_tool_events() -> None:
    result = await _run(_greeting_model())

    assert isinstance(result.output, GreetingResponseModel)
    assert result.intent == "greet_user"
    assert result.steps == []


async def test_plain_function_model_qa_needs_no_tool_events() -> None:
    result = await _run(_qa_model())

    assert isinstance(result.output, QAResponseModel)
    assert result.intent == "general_qa"
    assert result.steps == []


async def test_plain_function_model_clarify_needs_no_tool_events() -> None:
    result = await _run_with_context(_clarify_model(), _clarify_context())

    assert isinstance(result.output, ClarifyResponseModel)
    assert result.intent == "clarify"
    assert result.steps[-1].tool == "clarify"
