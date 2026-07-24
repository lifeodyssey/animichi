"""Eager web-tool and production hook behavior."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionDef, FunctionModel
from pydantic_ai.profiles import ModelProfile

from agent.agents.animichi_agent import build_animichi_agent
from agent.agents.runtime_deps import RuntimeDeps, TitleTranslator, WebSearcher
from agent.agents.runtime_models import ErrorResponseModel
from agent.agents.translation import TranslationResult
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.eval.mock_web import MockWebSearcher

_WEB_TOOLS = {"web_search", "translate_anime_title"}
_QA_OUTPUT = {"message": "ok"}


def _deps(
    *,
    title_translator: TitleTranslator | None = None,
    web_searcher: WebSearcher | None = None,
) -> RuntimeDeps:
    return RuntimeDeps(
        db=MagicMock(),
        locale="zh",
        query="translate",
        catalog=MockCatalogClient(),
        title_translator=title_translator,
        web_searcher=web_searcher,
    )


def _returned(messages: list[ModelMessage], tool_name: str) -> bool:
    return any(
        isinstance(part, ToolReturnPart) and part.tool_name == tool_name
        for message in messages
        for part in getattr(message, "parts", [])
    )


def _local_model(respond: FunctionDef) -> FunctionModel:
    return FunctionModel(
        respond, profile=ModelProfile(supported_native_tools=frozenset())
    )


async def test_eager_web_tools_are_offered_and_invoked_end_to_end() -> None:
    calls: list[tuple[str, str]] = []
    search = MockWebSearcher()

    async def translate(title: str, locale: str) -> TranslationResult:
        calls.append((title, locale))
        return TranslationResult(title, "你的名字", "catalog", 1.0)

    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        names = {tool.name for tool in info.function_tools}
        assert _WEB_TOOLS <= names
        if not _returned(messages, "translate_anime_title"):
            args = {"title": "君の名は。", "target_language": "zh"}
            return ModelResponse(parts=[ToolCallPart("translate_anime_title", args)])
        if not _returned(messages, "web_search"):
            return ModelResponse(
                parts=[ToolCallPart("web_search", {"query": "Uji anime location"})]
            )
        return ModelResponse(parts=[ToolCallPart("qa_response", _QA_OUTPUT)])

    result = await build_animichi_agent().run(
        "translate",
        deps=_deps(title_translator=translate, web_searcher=search),
        model=_local_model(respond),
    )
    assert result.output.message == "ok"
    assert calls == [("君の名は。", "zh")]
    assert search.calls == [("search", ("Uji anime location",))]


async def test_instructions_remain_cache_neutral_across_output_retry() -> None:
    instructions: list[str] = []

    def respond(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        instructions.append(info.instructions or "")
        args = {} if len(instructions) == 1 else _QA_OUTPUT
        return ModelResponse(parts=[ToolCallPart("qa_response", args)])

    await build_animichi_agent().run("retry", deps=_deps(), model=_local_model(respond))
    assert len(instructions) == 2
    assert instructions[0] == instructions[1]
    assert all("Current session state" not in text for text in instructions)


async def test_run_error_hook_records_then_sd18_boundary_converts_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The pre-SD-18 contract was "record telemetry, then re-raise" — proven by
    letting a bare RuntimeError blow up the whole run. SD-18 adds a 5th hook
    (error_boundary) composed alongside this one: telemetry recording is
    UNCHANGED (still happens exactly once), but the run now recovers with a
    typed ErrorResponseModel instead of propagating the raw exception."""
    recorded: list[BaseException] = []
    monkeypatch.setattr(
        "agent.agents.animichi_agent.record_agent_run_error", recorded.append
    )

    def fail(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        raise RuntimeError("model failed")

    result = await build_animichi_agent().run(
        "fail", deps=_deps(), model=FunctionModel(fail)
    )

    assert len(recorded) == 1
    assert isinstance(recorded[0], RuntimeError)
    assert isinstance(result.output, ErrorResponseModel)
