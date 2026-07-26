"""Web and translation tools participate in the centralized lifecycle."""

from __future__ import annotations

from functools import partial
from unittest.mock import MagicMock

from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.agent_result import AgentResult
from agent.agents.animichi_runner import run_animichi_agent
from agent.agents.runtime_deps import StepEvent
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.eval.mock_web import MockTitleTranslator, MockWebSearcher
from agent.tests.streaming_function_model import streaming_function_model


def _returned(messages: list[ModelMessage], tool: str) -> bool:
    return any(
        isinstance(part, ToolReturnPart) and part.tool_name == tool
        for message in messages
        for part in message.parts
    )


def _respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
    if not _returned(messages, "web_search"):
        part = ToolCallPart("web_search", {"query": "K-On"}, tool_call_id="web-id")
        return ModelResponse(parts=[part])
    if not _returned(messages, "translate_anime_title"):
        args = {"title": "K-On", "target_language": "ja"}
        part = ToolCallPart("translate_anime_title", args, tool_call_id="title-id")
        return ModelResponse(parts=[part])
    return ModelResponse(parts=[ToolCallPart("qa_response", {"message": "done"})])


def _driver() -> FunctionModel:
    return streaming_function_model(_respond)


_RUN_AGENT = partial(
    run_animichi_agent,
    text="translate K-On",
    db=MagicMock(),
    locale="en",
    catalog=MockCatalogClient(),
    web_searcher=MockWebSearcher(),
    title_translator=MockTitleTranslator(),
)


async def _capture(events: list[StepEvent], event: StepEvent) -> None:
    events.append(event)


async def _run(events: list[StepEvent]) -> AgentResult:
    return await _RUN_AGENT(model=_driver(), on_step=partial(_capture, events))


async def test_web_and_translate_are_in_result_and_progress_stream() -> None:
    events: list[StepEvent] = []
    result = await _run(events)
    _assert_steps(result)
    _assert_events(events)


def _assert_steps(result: AgentResult) -> None:
    assert [step.tool for step in result.steps] == [
        "web_search",
        "translate_anime_title",
    ]


def _assert_events(events: list[StepEvent]) -> None:
    assert [(event.call_id, event.status) for event in events] == [
        ("web-id", "running"),
        ("web-id", "done"),
        ("title-id", "running"),
        ("title-id", "done"),
    ]
