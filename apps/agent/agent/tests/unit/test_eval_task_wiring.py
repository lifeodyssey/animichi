"""Unit tests for eval task wiring of trajectory-only web seams."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import cast

from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.agent_result import AgentResult
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.eval.mock_web import MockTitleTranslator, MockWebSearcher
from agent.tests.eval.null_database import NullDatabase

Task = Callable[[object], Awaitable[AgentResult]]


def _returned(messages: list[ModelMessage], tool_name: str) -> bool:
    return any(
        isinstance(part, ToolReturnPart) and part.tool_name == tool_name
        for message in messages
        for part in getattr(message, "parts", [])
    )


def _qa_args() -> Mapping[str, object]:
    return {
        "intent": "general_qa",
        "message": "ok",
        "data": {"status": "info", "message": "ok"},
        "ui": {},
    }


def _web_driver(query: str) -> FunctionModel:
    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if not _returned(messages, "web_search"):
            return ModelResponse(parts=[ToolCallPart("web_search", {"query": query})])
        return ModelResponse(parts=[ToolCallPart("qa_response", _qa_args())])

    return FunctionModel(respond)


def _translation_driver(title: str, locale: str) -> FunctionModel:
    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if not _returned(messages, "translate_anime_title"):
            args = {"title": title, "target_language": locale}
            return ModelResponse(parts=[ToolCallPart("translate_anime_title", args)])
        return ModelResponse(parts=[ToolCallPart("qa_response", _qa_args())])

    return FunctionModel(respond)


def _tool_return(result: AgentResult, tool_name: str) -> str:
    for message in result.new_messages:
        for part in getattr(message, "parts", []):
            if isinstance(part, ToolReturnPart) and part.tool_name == tool_name:
                return str(part.content)
    raise AssertionError(f"missing tool return: {tool_name}")


def _load_task_factory() -> tuple[type[object], object]:
    from agent.tests.eval.test_agent_eval import AgentInput, make_agent_task

    return AgentInput, make_agent_task


async def test_make_agent_task_threads_mock_web_searcher() -> None:
    agent_input, make_agent_task = _load_task_factory()
    searcher = MockWebSearcher()
    task = cast(
        Task,
        make_agent_task(
            NullDatabase(),
            MockCatalogClient,
            _web_driver("Uji Sound Euphonium pilgrimage"),
            web_searcher=searcher,
        ),
    )

    result = await task(agent_input(query="宇治 anime pilgrimage", locale="en"))

    assert "響け！ユーフォニアム" in _tool_return(result, "web_search")
    assert searcher.calls == [("search", ("Uji Sound Euphonium pilgrimage",))]


async def test_make_agent_task_threads_mock_title_translator() -> None:
    agent_input, make_agent_task = _load_task_factory()
    translator = MockTitleTranslator()
    task = cast(
        Task,
        make_agent_task(
            NullDatabase(),
            MockCatalogClient,
            _translation_driver("君の名は。", "zh"),
            title_translator=translator,
        ),
    )

    result = await task(agent_input(query="translate title", locale="en"))

    assert "你的名字" in _tool_return(result, "translate_anime_title")
    assert translator.calls == [("translate", ("君の名は。", "zh"))]
