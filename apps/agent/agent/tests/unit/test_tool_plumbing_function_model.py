"""FunctionModel coverage for tool plumbing and typed output conversion.

The model response explicitly chooses each tool, so these tests do not prove
query-to-tool routing. The model-backed eval suite owns that behavior.
"""

from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import BaseModel
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.animichi_agent import animichi_agent
from agent.agents.animichi_runner import run_animichi_agent
from agent.agents.runtime_models import (
    ClarifyResponseModel,
    GreetingResponseModel,
    QAResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)
from agent.domain.ports import DatabasePort
from agent.tests.eval.mock_catalog_client import MockCatalogClient

_QA_OUTPUT = {
    "intent": "general_qa",
    "message": "Ready.",
    "data": {"status": "info", "message": "Ready."},
    "ui": {},
}
_GREETING_OUTPUT = {
    "intent": "greet_user",
    "message": "Hello.",
    "data": {"status": "info", "message": "Hello."},
    "ui": {},
}
_SEARCH_OUTPUT = {
    "intent": "search_bangumi",
    "message": "Found locations.",
    "data": {"results": {"rows": [], "row_count": 0}},
    "ui": {},
}
_NEARBY_OUTPUT = {
    **_SEARCH_OUTPUT,
    "intent": "search_nearby",
}
_ROUTE_OUTPUT = {
    "intent": "plan_route",
    "message": "Route ready.",
    "data": {"route": {"ordered_points": [], "point_count": 0}},
    "ui": {},
}
_CLARIFY_OUTPUT = {
    "intent": "clarify",
    "message": "Which anime?",
    "data": {
        "status": "needs_clarification",
        "question": "Which anime?",
        "options": [],
        "candidates": [],
    },
    "ui": {},
}
_ROUTE_CONTEXT: dict[str, object] = {
    "last_search_data": {"search_bangumi": {"rows": [{"id": "p001"}], "row_count": 1}}
}


def _db() -> DatabasePort:
    db = MagicMock()
    db.bangumi.find_candidate_details_by_titles = AsyncMock(return_value=[])
    return cast(DatabasePort, db)


def _returned(messages: list[ModelMessage], tool_name: str) -> bool:
    parts = [part for message in messages for part in getattr(message, "parts", [])]
    return any(getattr(part, "tool_name", None) == tool_name for part in parts)


def _driver(
    tool_name: str, args: dict[str, object], output_name: str, output: dict[str, object]
) -> FunctionModel:
    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        if _returned(messages, tool_name):
            return ModelResponse(parts=[ToolCallPart(output_name, output)])
        return ModelResponse(parts=[ToolCallPart(tool_name, args)])

    return FunctionModel(respond)


def _recorded_name(tool_name: str) -> str:
    return "answer_question" if tool_name == "general_qa" else tool_name


@pytest.mark.parametrize(
    ("query", "tool_name", "args", "output_name", "output", "family", "context"),
    [
        (
            "響けを探して",
            "resolve_anime",
            {"title": "響け"},
            "qa_response",
            _QA_OUTPUT,
            QAResponseModel,
            None,
        ),
        (
            "作品160209の聖地",
            "search_bangumi",
            {"bangumi_id": "160209"},
            "search_response",
            _SEARCH_OUTPUT,
            SearchResponseModel,
            None,
        ),
        (
            "西宮の近く",
            "search_nearby",
            {"location": "西宮"},
            "search_response",
            _NEARBY_OUTPUT,
            SearchResponseModel,
            None,
        ),
        (
            "この聖地を巡る",
            "plan_route",
            {},
            "route_response",
            _ROUTE_OUTPUT,
            RouteResponseModel,
            _ROUTE_CONTEXT,
        ),
        (
            "こんにちは",
            "greet_user",
            {"message": "Hello."},
            "greeting_response",
            _GREETING_OUTPUT,
            GreetingResponseModel,
            None,
        ),
        (
            "巡礼のマナーは？",
            "general_qa",
            {"answer": "Be respectful."},
            "qa_response",
            _QA_OUTPUT,
            QAResponseModel,
            None,
        ),
        (
            "どの作品？",
            "clarify",
            {"question": "Which anime?", "options": []},
            "clarify_response",
            _CLARIFY_OUTPUT,
            ClarifyResponseModel,
            None,
        ),
    ],
    ids=["resolve", "search", "nearby", "route", "greet", "qa", "clarify"],
)
async def test_scripted_tool_call_is_plumbed_to_typed_output(
    query: str,
    tool_name: str,
    args: dict[str, object],
    output_name: str,
    output: dict[str, object],
    family: type[BaseModel],
    context: dict[str, object] | None,
) -> None:
    model = _driver(tool_name, args, output_name, output)
    with animichi_agent.override(model=model):
        result = await run_animichi_agent(
            text=query,
            db=_db(),
            locale="ja",
            catalog=MockCatalogClient(),
            context=context,
        )

    assert [step.tool for step in result.steps] == [_recorded_name(tool_name)]
    assert isinstance(result.output, family)
