"""Wave 1 Batch B acceptance tests for hooks and progressive disclosure."""

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

from agent.agents.animichi_agent import (
    _modern_composition_enabled,
    build_animichi_agent,
)
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.translation import TranslationResult
from agent.tests.eval.mock_catalog_client import MockCatalogClient

_EAGER = {
    "clarify",
    "resolve_anime",
    "search_bangumi",
    "search_nearby",
    "plan_route",
    "greet_user",
    "general_qa",
}
_DEFERRED = {"web_search", "translate_anime_title"}
_QA_OUTPUT = {
    "intent": "general_qa",
    "message": "ok",
    "data": {"status": "info", "message": "ok"},
    "ui": {},
}


def test_environment_switch_defaults_on_and_accepts_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ANIMICHI_MODERN_COMPOSITION", raising=False)
    assert _modern_composition_enabled() is True
    monkeypatch.setenv("ANIMICHI_MODERN_COMPOSITION", "0")
    assert _modern_composition_enabled() is False


def _deps(*, title_translator: object | None = None) -> RuntimeDeps:
    return RuntimeDeps(
        db=MagicMock(),
        locale="zh",
        query="translate",
        catalog=MockCatalogClient(),
        title_translator=title_translator,
    )


def _returned(messages: list[ModelMessage], tool_name: str) -> bool:
    return any(
        isinstance(part, ToolReturnPart) and part.tool_name == tool_name
        for message in messages
        for part in getattr(message, "parts", [])
    )


def _local_model(respond: FunctionDef) -> FunctionModel:
    """FunctionModel configured like a gateway without native tool search."""
    return FunctionModel(
        respond,
        profile=ModelProfile(supported_native_tools=frozenset()),
    )


@pytest.mark.parametrize(
    ("modern", "present", "absent"),
    [
        (True, _EAGER | {"search_tools"}, _DEFERRED),
        (False, _EAGER | _DEFERRED, {"search_tools"}),
    ],
)
async def test_composition_switch_controls_first_request_tools(
    modern: bool, present: set[str], absent: set[str]
) -> None:
    observed: set[str] = set()

    def respond(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        observed.update(tool.name for tool in info.function_tools)
        return ModelResponse(parts=[ToolCallPart("qa_response", _QA_OUTPUT)])

    await build_animichi_agent(modern_composition=modern).run(
        "hello", deps=_deps(), model=_local_model(respond)
    )

    assert present <= observed
    assert observed.isdisjoint(absent)


async def test_deferred_tool_is_discovered_and_invoked_end_to_end() -> None:
    calls: list[tuple[str, str]] = []

    async def translate(title: str, locale: str) -> TranslationResult:
        calls.append((title, locale))
        return TranslationResult(title, "你的名字", "test", 1.0)

    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        names = {tool.name for tool in info.function_tools}
        if "translate_anime_title" not in names:
            return ModelResponse(
                parts=[
                    ToolCallPart("search_tools", {"queries": ["translate anime title"]})
                ]
            )
        if not _returned(messages, "translate_anime_title"):
            args = {"title": "君の名は。", "target_language": "zh"}
            return ModelResponse(parts=[ToolCallPart("translate_anime_title", args)])
        return ModelResponse(parts=[ToolCallPart("qa_response", _QA_OUTPUT)])

    result = await build_animichi_agent(modern_composition=True).run(
        "translate", deps=_deps(title_translator=translate), model=_local_model(respond)
    )

    assert result.output.intent == "general_qa"
    assert calls == [("君の名は。", "zh")]


async def test_session_hook_is_idempotent_across_output_retry() -> None:
    instructions: list[str] = []

    def respond(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        instructions.append(info.instructions or "")
        args = {} if len(instructions) == 1 else _QA_OUTPUT
        return ModelResponse(parts=[ToolCallPart("qa_response", args)])

    await build_animichi_agent(modern_composition=True).run(
        "retry", deps=_deps(), model=_local_model(respond)
    )

    assert len(instructions) == 2
    counts = [text.count("## Current session state") for text in instructions]
    assert counts == [1, 1], instructions


async def test_modern_switch_records_run_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorded: list[BaseException] = []
    monkeypatch.setattr(
        "agent.agents.animichi_agent.record_agent_run_error", recorded.append
    )

    def fail(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        raise RuntimeError("model failed")

    with pytest.raises(RuntimeError, match="model failed"):
        await build_animichi_agent(modern_composition=True).run(
            "fail", deps=_deps(), model=FunctionModel(fail)
        )

    assert len(recorded) == 1


async def test_legacy_switch_keeps_error_path_outside_hooks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorded: list[BaseException] = []
    monkeypatch.setattr(
        "agent.agents.animichi_agent.record_agent_run_error", recorded.append
    )

    def fail(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        raise RuntimeError("legacy failed")

    with pytest.raises(RuntimeError, match="legacy failed"):
        await build_animichi_agent(modern_composition=False).run(
            "fail", deps=_deps(), model=FunctionModel(fail)
        )

    assert recorded == []
