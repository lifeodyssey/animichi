"""Unit tests for the SD-18 error-boundary hook.

The hook unifies tool-execution exceptions and agent-loop exceptions onto one
typed, localized payload (``ErrorResponseModel``) instead of each call site
erroring ad hoc. It reuses ``error_messages.build_error_message`` for
localization rather than duplicating the catalog-error -> string mapping.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pydantic_ai import RunContext
from pydantic_ai.agent import AgentRunResult
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.tools import ToolDefinition
from pydantic_ai.usage import RunUsage

from agent.agents import error_boundary
from agent.agents.animichi_runner import run_animichi_agent
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.runtime_models import ErrorResponseModel, QAResponseModel
from agent.clients.catalog_client import ResolveNotFound, ResolveResolved
from agent.clients.catalog_errors import WorkNotFoundData, WorkNotFoundError
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def _deps(locale: str = "ja") -> RuntimeDeps:
    return RuntimeDeps(
        db=MagicMock(), locale=locale, query="q", catalog=MockCatalogClient()
    )


def _ctx(locale: str = "ja") -> RunContext[RuntimeDeps]:
    return RunContext(deps=_deps(locale), model=TestModel(), usage=RunUsage())


def _tool_returned(messages: list[ModelMessage], tool_name: str) -> str | None:
    from pydantic_ai.messages import ToolReturnPart

    for message in messages:
        for part in getattr(message, "parts", []):
            if isinstance(part, ToolReturnPart) and part.tool_name == tool_name:
                return str(part.content)
    return None


def test_map_exception_reuses_error_messages_for_catalog_errors() -> None:
    exc = WorkNotFoundError(WorkNotFoundData(bangumi_id="8000"))

    payload = error_boundary.map_exception_to_error_response(exc, "en")

    assert payload.message == (
        "No pilgrimage spots found for this work. Try a different anime."
    )
    assert payload.error is True


def test_map_exception_falls_back_per_locale_for_generic_exceptions() -> None:
    exc = ValueError("some internal bug")

    en = error_boundary.map_exception_to_error_response(exc, "en")
    zh = error_boundary.map_exception_to_error_response(exc, "zh")

    assert en.message == "Something went wrong on our side. Please try again later."
    assert zh.message == "我们这边出了点问题，请稍后再试。"


async def test_tool_and_run_errors_flow_through_the_one_mapper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[Exception] = []
    original = error_boundary.map_exception_to_error_response

    def spy(error: Exception, locale: str) -> ErrorResponseModel:
        calls.append(error)
        return original(error, locale)

    monkeypatch.setattr(error_boundary, "map_exception_to_error_response", spy)

    tool_error = ValueError("catalog client returned a malformed response")
    tool_result = await error_boundary._on_tool_execute_error(
        _ctx("zh"),
        call=ToolCallPart("resolve_anime", {"title": "x"}),
        tool_def=ToolDefinition(name="resolve_anime"),
        args={"title": "x"},
        error=tool_error,
    )

    loop_error = RuntimeError("the model backend misbehaved")
    run_result = await error_boundary._on_run_error(_ctx("zh"), error=loop_error)

    assert calls == [tool_error, loop_error]
    assert tool_result == {"message": "我们这边出了点问题，请稍后再试。", "error": True}
    assert isinstance(run_result, AgentRunResult)
    assert isinstance(run_result.output, ErrorResponseModel)
    assert run_result.output.message == "我们这边出了点问题，请稍后再试。"


async def test_on_run_error_reraises_exception_types_already_handled_elsewhere() -> (
    None
):
    already_handled = UsageLimitExceeded("request limit reached")

    with pytest.raises(UsageLimitExceeded):
        await error_boundary._on_run_error(_ctx(), error=already_handled)


async def test_on_run_error_reraises_base_exceptions() -> None:
    with pytest.raises(KeyboardInterrupt):
        await error_boundary._on_run_error(_ctx(), error=KeyboardInterrupt())


async def test_tool_execution_exception_is_converted_end_to_end() -> None:
    class _RaisingCatalog(MockCatalogClient):
        async def resolve(self, query: str) -> ResolveResolved | ResolveNotFound:
            raise ValueError("catalog client returned a malformed response")

    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        if _tool_returned(messages, "resolve_anime") is None:
            return ModelResponse(
                parts=[ToolCallPart("resolve_anime", {"title": "test"})]
            )
        return ModelResponse(parts=[ToolCallPart("qa_response", {"message": "ok"})])

    result = await run_animichi_agent(
        text="test anime",
        db=MagicMock(),
        locale="ja",
        catalog=_RaisingCatalog(),
        model=FunctionModel(respond),
    )

    assert isinstance(result.output, QAResponseModel)
    tool_return = _tool_returned(result.new_messages, "resolve_anime")
    assert tool_return is not None
    assert "サーバー側で問題が発生しました" in tool_return


async def test_agent_loop_exception_is_a_terminal_error_result_end_to_end() -> None:
    """Goes through run_animichi_agent (not build_animichi_agent().run()
    directly), so this also proves the recovered ErrorResponseModel reaches
    the runner's own _terminal_status/AgentResult construction, marking the
    turn as a failed, non-retryable result (status/success), not just that
    the underlying agent run recovers."""

    def fail(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        raise RuntimeError("the model backend misbehaved")

    result = await run_animichi_agent(
        text="hello",
        db=MagicMock(),
        locale="zh",
        catalog=MockCatalogClient(),
        model=FunctionModel(fail),
    )

    assert isinstance(result.output, ErrorResponseModel)
    assert result.output.message == "我们这边出了点问题，请稍后再试。"
    assert result.status == "error"
    assert result.success is False
    assert result.intent == "error"
