"""Eval: drive the LIVE agent run against the MockCatalogClient (offline).

W2-A1 lands the seam that lets ``run_pilgrimage_agent`` route its data tools
through an injected catalog client. These cases promote a handful of the
representative eval cases to actually drive the agent — with a deterministic
``FunctionModel`` standing in for the LLM — and assert:

  - the agent produces valid typed output (no plain strings),
  - using ONLY the mock catalog (no DB, no network),
  - making ZERO upstream-client calls (the spy records only catalog methods).

The FunctionModel scripts the tool sequence a real model would choose, so the
run is fast, offline, and deterministic; the LLM is not exercised here.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.agent_result import AgentResult
from agent.agents.pilgrimage_runner import run_pilgrimage_agent
from agent.agents.runtime_models import (
    QAResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)
from agent.tests.eval.mock_catalog_client import MockCatalogClient

_ALLOWED_CATALOG_METHODS = {"search", "spots", "nearby", "route"}


def _returned(messages: list[ModelMessage], tool_name: str) -> bool:
    return any(
        getattr(p, "tool_name", None) == tool_name
        for m in messages
        for p in getattr(m, "parts", [])
    )


def _search_output(intent: str) -> dict[str, object]:
    return {
        "intent": intent,
        "message": "見つかりました。",
        "data": {"results": {"rows": [], "row_count": 0, "status": "ok"}},
        "ui": {},
    }


def _search_driver(intent: str, *, title: str) -> FunctionModel:
    """resolve_anime -> search_bangumi -> search_response."""

    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if not _returned(messages, "resolve_anime"):
            return ModelResponse(
                parts=[ToolCallPart("resolve_anime", {"title": title})]
            )
        if not _returned(messages, "search_bangumi"):
            return ModelResponse(parts=[ToolCallPart("search_bangumi", {})])
        return ModelResponse(
            parts=[ToolCallPart("search_response", _search_output(intent))]
        )

    return FunctionModel(respond)


async def _run(
    model: FunctionModel, *, text: str
) -> tuple[AgentResult, MockCatalogClient]:
    catalog = MockCatalogClient()
    result = await run_pilgrimage_agent(
        text=text, db=MagicMock(), locale="ja", model=model, catalog=catalog
    )
    return result, catalog


_RESOLVABLE = [
    ("A1_ja", "君の名は。の聖地を教えて", "君の名は。"),
    ("A1_zh", "你的名字的圣地在哪里", "你的名字"),
    ("A1_en", "Where are the Your Name pilgrimage spots?", "Your Name"),
    ("A1_euph", "響け！ユーフォニアムの聖地", "響け！ユーフォニアム"),
]


@pytest.mark.parametrize(("case_id", "text", "title"), _RESOLVABLE)
async def test_resolvable_case_returns_search_output(
    case_id: str, text: str, title: str
) -> None:
    """Resolvable anime yields a typed SearchResponse via the mock catalog."""
    result, _ = await _run(_search_driver("search_bangumi", title=title), text=text)
    assert isinstance(result.output, SearchResponseModel), case_id


@pytest.mark.parametrize(("case_id", "text", "title"), _RESOLVABLE)
async def test_resolvable_case_uses_only_catalog(
    case_id: str, text: str, title: str
) -> None:
    """The run records only catalog methods — zero upstream-client calls."""
    _, catalog = await _run(_search_driver("search_bangumi", title=title), text=text)
    methods = {name for name, _ in catalog.calls}
    assert methods <= _ALLOWED_CATALOG_METHODS, catalog.calls
    assert methods, "expected at least one catalog call"


def _unknown_anime_driver(title: str) -> FunctionModel:
    """resolve_anime (miss) -> qa_response reporting no data was found."""

    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if not _returned(messages, "resolve_anime"):
            return ModelResponse(
                parts=[ToolCallPart("resolve_anime", {"title": title})]
            )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    "qa_response",
                    {
                        "intent": "general_qa",
                        "message": "そのアニメの聖地データは見つかりませんでした。",
                        "data": {"status": "info", "message": "no data"},
                        "ui": {},
                    },
                )
            ]
        )

    return FunctionModel(respond)


async def test_unknown_anime_returns_typed_output_via_catalog() -> None:
    """An unresolvable title: resolve misses, agent answers, zero upstream."""
    text = "魔法少女マジカルドリーマーの聖地"
    result, catalog = await _run(_unknown_anime_driver(text), text=text)
    assert isinstance(result.output, QAResponseModel)
    assert catalog.calls == [("search", (text,))]


def _route_driver(title: str) -> FunctionModel:
    """resolve -> search -> plan_route -> route_response."""

    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if not _returned(messages, "resolve_anime"):
            return ModelResponse(
                parts=[ToolCallPart("resolve_anime", {"title": title})]
            )
        if not _returned(messages, "search_bangumi"):
            return ModelResponse(parts=[ToolCallPart("search_bangumi", {})])
        if not _returned(messages, "plan_route"):
            return ModelResponse(parts=[ToolCallPart("plan_route", {})])
        return ModelResponse(
            parts=[
                ToolCallPart(
                    "route_response",
                    {
                        "intent": "plan_route",
                        "message": "ルートを作成しました。",
                        "data": {"route": {"ordered_points": [], "point_count": 0}},
                        "ui": {},
                    },
                )
            ]
        )

    return FunctionModel(respond)


async def test_route_case_returns_route_output_via_catalog() -> None:
    """A full resolve->search->route flow yields typed RouteResponse offline."""
    result, catalog = await _run(
        _route_driver("響け！ユーフォニアム"), text="響けの聖地を巡るルート"
    )
    assert isinstance(result.output, RouteResponseModel)
    assert ("route", (("p_euph_1", "p_euph_2"),)) in catalog.calls
    assert {name for name, _ in catalog.calls} <= _ALLOWED_CATALOG_METHODS
