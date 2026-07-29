"""Pins for the six-tool catalog/web surface and typed endpoint wiring."""

from __future__ import annotations

import ast
from pathlib import Path

from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.tools import Tool, ToolFuncEither

from agent.agents.animichi_agent import animichi_agent
from agent.agents.animichi_runner import run_animichi_agent
from agent.agents.animichi_tools import CATALOG_TOOL_TIMEOUT_SECONDS
from agent.agents.animichi_tools import TOOLS as ANIMICHI_TOOLS
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.web_tools import TOOLS as WEB_TOOLS
from agent.domain.ports import BangumiRepo, DatabasePort, PointsRepo
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.streaming_function_model import streaming_function_model

_TOOL_NAMES = {
    "resolve_anime",
    "search_bangumi",
    "search_nearby",
    "plan_route",
    "web_search",
    "translate_anime_title",
}


class _ExplodingDB:
    @property
    def bangumi(self) -> BangumiRepo:
        raise AssertionError("catalog tool touched the database")

    @property
    def points(self) -> PointsRepo:
        raise AssertionError("catalog tool touched the database")


def _no_db() -> DatabasePort:
    return _ExplodingDB()


def _name(entry: Tool[RuntimeDeps] | ToolFuncEither[RuntimeDeps]) -> str:
    return entry.name if isinstance(entry, Tool) else entry.__name__


def test_agent_has_exact_six_tools_and_no_echo_or_search_meta_tools() -> None:
    assert {_name(tool) for tool in [*ANIMICHI_TOOLS, *WEB_TOOLS]} == _TOOL_NAMES
    assert set(animichi_agent._function_toolset.tools) == _TOOL_NAMES
    assert {"clarify", "greet_user", "general_qa"}.isdisjoint(_TOOL_NAMES)
    assert {"read_tool_result", "search_tools"}.isdisjoint(_TOOL_NAMES)
    assert all(tool.timeout == CATALOG_TOOL_TIMEOUT_SECONDS for tool in ANIMICHI_TOOLS)


def test_plan_route_tool_definition_requires_explicit_ref_and_optional_pacing() -> None:
    definition = ANIMICHI_TOOLS[-1].tool_def
    assert definition.parameters_json_schema == {
        "additionalProperties": False,
        "properties": {
            "search_result_ref": {"minLength": 1, "type": "string"},
            "pacing": {
                "anyOf": [
                    {"enum": ["chill", "normal", "packed"], "type": "string"},
                    {"type": "null"},
                ],
                "default": None,
            },
        },
        "required": ["search_result_ref"],
        "type": "object",
    }
    assert definition.description is not None
    assert "no session default" in definition.description


def _description(tool_name: str) -> str:
    tool = next(t for t in ANIMICHI_TOOLS if t.tool_def.name == tool_name)
    description = tool.tool_def.description
    assert description is not None
    return description


def test_resolve_anime_docstring_states_when_not_to_call_it() -> None:
    description = _description("resolve_anime")
    assert "Do not call this again" in description
    assert "search_bangumi" in description.split("Do not call this again")[1]


def test_search_bangumi_docstring_states_when_not_to_call_it() -> None:
    description = _description("search_bangumi")
    assert "Do not call this" in description
    assert "search_nearby" in description


def test_plan_route_description_states_when_not_to_call_it() -> None:
    description = _description("plan_route")
    assert "Do not call this" in description
    assert "only asks for a search" in description


def test_web_search_docstring_already_states_when_not_to_use_it() -> None:
    """SD-17b audit: web_search already carries a counter-example — unchanged."""
    tool = next(t for t in WEB_TOOLS if _name(t) == "web_search")
    doc = tool.__doc__
    assert doc is not None
    assert "Do not use this tool to find pilgrimage locations" in doc


def test_agent_registers_tools_at_construction() -> None:
    path = Path(__file__).parents[2] / "agents" / "animichi_agent.py"
    calls = [
        node
        for node in ast.walk(ast.parse(path.read_text()))
        if isinstance(node, ast.Call)
    ]
    construction = next(
        call
        for call in calls
        if isinstance(call.func, ast.Name) and call.func.id == "Agent"
    )
    assert "tools" in {keyword.arg for keyword in construction.keywords}


def _resolve_then_answer() -> FunctionModel:
    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        called = any(_returned(message, "resolve_anime") for message in messages)
        part = (
            ToolCallPart("qa_response", {"message": "done"})
            if called
            else ToolCallPart("resolve_anime", {"title": "君の名は。"})
        )
        return ModelResponse(parts=[part])

    return streaming_function_model(respond)


def _returned(message: ModelMessage, tool: str) -> bool:
    return any(getattr(part, "tool_name", None) == tool for part in message.parts)


async def test_resolve_tool_calls_catalog_resolve_and_never_database() -> None:
    catalog = MockCatalogClient()
    await run_animichi_agent(
        text="君の名は。",
        db=_no_db(),
        locale="ja",
        model=_resolve_then_answer(),
        catalog=catalog,
    )
    assert ("resolve", ("君の名は。",)) in catalog.calls
