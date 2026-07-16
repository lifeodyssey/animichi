"""FunctionModel coverage for the four real tools and compact outputs."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.animichi_runner import run_animichi_agent
from agent.agents.runtime_models import (
    ClarifyResponseModel,
    QAResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def _returned(messages: list[ModelMessage], tool_name: str) -> bool:
    return any(
        getattr(part, "tool_name", None) == tool_name
        for message in messages
        for part in getattr(message, "parts", [])
    )


def _search_model(*, nearby: bool = False) -> FunctionModel:
    tool = "search_nearby" if nearby else "search_bangumi"

    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        if not nearby and not _returned(messages, "resolve_anime"):
            return ModelResponse(
                parts=[ToolCallPart("resolve_anime", {"title": "君の名は。"})]
            )
        if not _returned(messages, tool):
            args = {"location": "宇治"} if nearby else {"bangumi_id": "160209"}
            return ModelResponse(parts=[ToolCallPart(tool, args)])
        return ModelResponse(
            parts=[ToolCallPart("search_response", {"message": "Found."})]
        )

    return FunctionModel(respond)


def _route_model() -> FunctionModel:
    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        if not _returned(messages, "resolve_anime"):
            return ModelResponse(
                parts=[ToolCallPart("resolve_anime", {"title": "君の名は。"})]
            )
        if not _returned(messages, "search_bangumi"):
            return ModelResponse(
                parts=[ToolCallPart("search_bangumi", {"bangumi_id": "160209"})]
            )
        if not _returned(messages, "plan_route"):
            return ModelResponse(
                parts=[ToolCallPart("plan_route", {"search_result_ref": "search:3:1"})]
            )
        return ModelResponse(
            parts=[ToolCallPart("route_response", {"message": "Route ready."})]
        )

    return FunctionModel(respond)


@pytest.mark.parametrize(
    ("model", "intent", "family", "steps"),
    [
        (
            _search_model(),
            "search_bangumi",
            SearchResponseModel,
            ["resolve_anime", "search_bangumi"],
        ),
        (
            _search_model(nearby=True),
            "search_nearby",
            SearchResponseModel,
            ["geocode", "search_nearby"],
        ),
        (
            _route_model(),
            "plan_route",
            RouteResponseModel,
            ["resolve_anime", "search_bangumi", "plan_route"],
        ),
    ],
)
async def test_real_tool_chain_builds_server_owned_stage(
    model: FunctionModel,
    intent: str,
    family: type[SearchResponseModel] | type[RouteResponseModel],
    steps: list[str],
) -> None:
    result = await run_animichi_agent(
        text="query",
        db=MagicMock(),
        locale="ja",
        catalog=MockCatalogClient(),
        model=model,
    )

    assert result.intent == intent
    assert isinstance(result.output, family)
    assert [step.tool for step in result.steps] == steps


async def test_not_found_resolve_can_emit_terminal_clarify() -> None:
    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        if not _returned(messages, "resolve_anime"):
            return ModelResponse(
                parts=[ToolCallPart("resolve_anime", {"title": "not real"})]
            )
        payload = {
            "reason": "anime_not_found",
            "message": "Please check the title.",
            "candidate_ids": [],
        }
        return ModelResponse(parts=[ToolCallPart("clarify_response", payload)])

    result = await run_animichi_agent(
        text="not real",
        db=MagicMock(),
        locale="en",
        catalog=MockCatalogClient(),
        model=FunctionModel(respond),
    )

    assert isinstance(result.output, ClarifyResponseModel)
    assert result.intent == "clarify"
    assert [step.tool for step in result.steps] == ["resolve_anime", "clarify"]
    assert result.steps[-1].model_initiated is False


async def test_direct_outputs_need_no_echo_tool() -> None:
    def respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        return ModelResponse(
            parts=[ToolCallPart("qa_response", {"message": "Full answer."})]
        )

    result = await run_animichi_agent(
        text="hello",
        db=MagicMock(),
        locale="en",
        catalog=MockCatalogClient(),
        model=FunctionModel(respond),
    )

    assert isinstance(result.output, QAResponseModel)
    assert result.intent == "general_qa"
    assert result.steps == []
