"""Unit tests: data tools route through the injected CatalogClient.

These drive the real ``run_animichi_agent`` with a ``FunctionModel`` that calls
one data tool with controlled args, then returns the typed output. The injected
``MockCatalogClient`` is a spy, so we assert the tool called the expected catalog
method with the expected args — and never touched the DB / upstream APIs.
"""

from __future__ import annotations

import ast
from pathlib import Path

from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.animichi_agent import animichi_agent
from agent.agents.animichi_runner import run_animichi_agent
from agent.agents.animichi_tools import TOOLS as ANIMICHI_TOOLS
from agent.agents.web_tools import TOOLS as WEB_TOOLS
from agent.domain.ports import BangumiRepo, DatabasePort, PointsRepo
from agent.tests.eval.mock_catalog_client import MockCatalogClient


class _ExplodingDB:
    """A DatabasePort double that raises if either repo is touched.

    The catalog path must never reach the DB. Using this (instead of a permissive
    MagicMock) makes the zero-DB guarantee fail loudly rather than silently pass.
    """

    @property
    def bangumi(self) -> BangumiRepo:
        raise AssertionError("catalog-path tool touched the DB: deps.db.bangumi")

    @property
    def points(self) -> PointsRepo:
        raise AssertionError("catalog-path tool touched the DB: deps.db.points")


def _no_db() -> DatabasePort:
    return _ExplodingDB()


_GREETING_OUTPUT = {
    "intent": "greet_user",
    "message": "done",
    "data": {"status": "info", "message": "done"},
    "ui": {},
}

_EXPECTED_TOOL_NAMES = {
    "resolve_anime",
    "search_bangumi",
    "search_nearby",
    "plan_route",
    "greet_user",
    "general_qa",
    "clarify",
    "web_search",
    "translate_anime_title",
}


def test_agent_constructed_with_exact_tool_catalog() -> None:
    """All nine stable eval-facing names are injected at construction time."""
    definitions = [*ANIMICHI_TOOLS, *WEB_TOOLS]
    assert {tool.__name__ for tool in definitions} == _EXPECTED_TOOL_NAMES
    assert set(animichi_agent._function_toolset.tools) == _EXPECTED_TOOL_NAMES


def test_agent_registers_tools_during_construction() -> None:
    path = Path(__file__).parents[2] / "agents" / "animichi_agent.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)]
    construction = next(
        call
        for call in calls
        if isinstance(call.func, ast.Name) and call.func.id == "Agent"
    )
    assert "tools" in {keyword.arg for keyword in construction.keywords}


def _tool_then_output(tool_name: str, args: dict[str, object]) -> FunctionModel:
    """A model that calls one data tool, then returns a greeting_response."""

    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        called = any(_has_tool_return(m, tool_name) for m in messages)
        if called:
            return ModelResponse(
                parts=[ToolCallPart("greeting_response", _GREETING_OUTPUT)]
            )
        return ModelResponse(parts=[ToolCallPart(tool_name, args)])

    return FunctionModel(respond)


def _has_tool_return(message: ModelMessage, tool_name: str) -> bool:
    parts = getattr(message, "parts", [])
    return any(getattr(p, "tool_name", None) == tool_name for p in parts)


async def _run(model: FunctionModel, *, text: str) -> MockCatalogClient:
    catalog = MockCatalogClient()
    await run_animichi_agent(
        text=text, db=_no_db(), locale="ja", model=model, catalog=catalog
    )
    return catalog


async def test_resolve_anime_calls_catalog_search() -> None:
    catalog = await _run(
        _tool_then_output("resolve_anime", {"title": "君の名は。"}),
        text="君の名は。の聖地",
    )
    assert ("search", ("君の名は。",)) in catalog.calls


async def test_search_bangumi_calls_catalog_search_with_bangumi_id() -> None:
    catalog = await _run(
        _tool_then_output("search_bangumi", {"bangumi_id": "160209"}),
        text="search",
    )
    assert ("search", ("160209",)) in catalog.calls


async def test_search_nearby_calls_catalog_nearby() -> None:
    catalog = await _run(
        _tool_then_output("search_nearby", {"location": "宇治"}),
        text="宇治附近",
    )
    methods = [name for name, _ in catalog.calls]
    assert "nearby" in methods


async def test_data_tools_make_zero_upstream_calls() -> None:
    """GOAL 4.3: the agent run records only catalog methods, no upstream."""
    catalog = await _run(
        _tool_then_output("resolve_anime", {"title": "君の名は。"}),
        text="君の名は。",
    )
    allowed = {"search", "spots", "nearby", "geocode", "route"}
    assert all(name in allowed for name, _ in catalog.calls), catalog.calls
    assert catalog.calls, "expected at least one catalog call"


async def test_greeting_makes_no_catalog_calls() -> None:
    """Ephemeral tools (greet_user) must not touch the catalog."""

    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(
            parts=[ToolCallPart("greeting_response", _GREETING_OUTPUT)]
        )

    catalog = MockCatalogClient()
    await run_animichi_agent(
        text="hi",
        db=_no_db(),
        locale="en",
        model=FunctionModel(respond),
        catalog=catalog,
    )
    assert catalog.calls == []
