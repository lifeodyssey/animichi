"""Unit tests for deterministic trajectory-tier web seams."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import cast
from unittest.mock import MagicMock

import pytest
from pydantic_ai import RunContext
from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.agent_result import AgentResult
from agent.agents.animichi_runner import run_animichi_agent
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.web_tools import translate_anime_title, web_search
from agent.domain.ports import DatabasePort
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.eval.mock_web import MockTitleTranslator, MockWebSearcher
from agent.tests.eval.null_database import NullDatabase


@dataclass
class _Ctx:
    deps: RuntimeDeps


def _ctx(deps: RuntimeDeps) -> RunContext[RuntimeDeps]:
    return cast(RunContext[RuntimeDeps], _Ctx(deps))


def _deps(*, db: object | None = None) -> RuntimeDeps:
    return RuntimeDeps(
        db=cast(DatabasePort, db or MagicMock()),
        locale="zh",
        query="test",
        catalog=MockCatalogClient(),
    )


async def test_mock_web_searcher_known_query_is_deterministic() -> None:
    searcher = MockWebSearcher()

    first = await searcher("Sound Euphonium pilgrimage in Uji")
    second = await searcher("Sound Euphonium pilgrimage in Uji")

    assert first
    assert first == second
    assert "響け！ユーフォニアム" in first[0].body


async def test_mock_web_searcher_unknown_query_returns_empty() -> None:
    assert await MockWebSearcher()("unknown series in nowhere") == []


async def test_mock_title_translator_known_names_are_authoritative() -> None:
    translator = MockTitleTranslator()

    zh = await translator("君の名は。", "zh")
    ja = await translator("你的名字", "ja")

    assert zh.translated == "你的名字"
    assert ja.translated == "君の名は。"
    assert zh.confidence == pytest.approx(1.0)
    assert ja.confidence == pytest.approx(1.0)


async def test_mock_title_translator_unknown_returns_low_confidence() -> None:
    result = await MockTitleTranslator()("未知作品", "en")

    assert result.original == "未知作品"
    assert result.translated == "未知作品"
    assert result.confidence < 0.5


def test_runtime_deps_web_seams_default_to_none() -> None:
    deps = _deps()

    assert deps.web_searcher is None
    assert deps.title_translator is None


def _returned(messages: list[ModelMessage], tool_name: str) -> bool:
    return any(
        isinstance(part, ToolReturnPart) and part.tool_name == tool_name
        for message in messages
        for part in getattr(message, "parts", [])
    )


def _web_driver(query: str) -> FunctionModel:
    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if not _returned(messages, "web_search"):
            return ModelResponse(parts=[ToolCallPart("web_search", {"query": query})])
        return ModelResponse(parts=[ToolCallPart("qa_response", _qa_args())])

    return FunctionModel(respond)


def _qa_args() -> Mapping[str, object]:
    return {"message": "Found reference material."}


def _tool_return(result: AgentResult, tool_name: str) -> str:
    for message in result.new_messages:
        for part in getattr(message, "parts", []):
            if isinstance(part, ToolReturnPart) and part.tool_name == tool_name:
                return str(part.content)
    raise AssertionError(f"missing tool return: {tool_name}")


async def test_web_search_function_model_uses_injected_searcher() -> None:
    searcher = MockWebSearcher()

    result = await run_animichi_agent(
        text="宇治 anime pilgrimage",
        db=MagicMock(),
        locale="en",
        catalog=MockCatalogClient(),
        model=_web_driver("Uji Sound Euphonium pilgrimage"),
        web_searcher=searcher,
    )

    wrapped = _tool_return(result, "web_search")
    assert "<untrusted_web_result>" in wrapped
    assert "響け！ユーフォニアム" in wrapped
    assert searcher.calls == [("search", ("Uji Sound Euphonium pilgrimage",))]


async def test_translate_title_injection_bypasses_null_database() -> None:
    deps = _deps(db=NullDatabase())
    deps.title_translator = MockTitleTranslator()

    result = await translate_anime_title(
        _ctx(deps), title="響け！ユーフォニアム", target_language="zh"
    )

    assert result["translated"] == "吹响悠风号"
    assert result["source"] == "db"


async def test_web_search_direct_injection_returns_wrapped_results() -> None:
    deps = _deps()
    deps.web_searcher = MockWebSearcher()

    result = await web_search(_ctx(deps), query="Your Name Tokyo stairs")

    assert "<untrusted_web_result>" in result
    assert "君の名は。" in result


async def test_mock_catalog_route_accepts_dataset_point_ids() -> None:
    route = await MockCatalogClient().route(["p004", "p005"])

    assert route.point_count == 2
