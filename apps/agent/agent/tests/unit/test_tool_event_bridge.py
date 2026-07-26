"""Characterize official function-tool lifecycle projection."""

from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import MagicMock

from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    RetryPromptPart,
    ToolCallPart,
    ToolReturnPart,
)
from structlog import testing

from agent.agents.agent_result import ProducedSearch
from agent.agents.runtime_deps import RuntimeDeps, StepEvent
from agent.agents.session_state import ResultRef
from agent.agents.tool_event_bridge import tool_event_bridge
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def _deps() -> RuntimeDeps:
    return RuntimeDeps(MagicMock(), "en", "query", MockCatalogClient())


async def _stream(*events: object) -> AsyncIterator[object]:
    for event in events:
        yield event


def _call(tool: str, call_id: str, args: object) -> FunctionToolCallEvent:
    return FunctionToolCallEvent(ToolCallPart(tool, args, tool_call_id=call_id))


def _result(
    tool: str, call_id: str, content: object, outcome: str = "success"
) -> FunctionToolResultEvent:
    part = ToolReturnPart(tool, content, tool_call_id=call_id, outcome=outcome)
    return FunctionToolResultEvent(part)


async def _handle(deps: RuntimeDeps, *events: object) -> list[StepEvent]:
    captured: list[StepEvent] = []

    async def capture(event: StepEvent) -> None:
        captured.append(event)

    deps.on_step = capture
    await tool_event_bridge(MagicMock(deps=deps), _stream(*events))
    return captured


async def test_catalog_events_preserve_raw_params_and_payload() -> None:
    deps = _deps()
    events = await _handle(
        deps,
        _call("resolve_anime", "call-1", '{"title":"君の名は。"}'),
        _result("resolve_anime", "call-1", {"outcome": "resolved"}),
    )
    _assert_catalog_events(deps, events)


def _assert_catalog_events(deps: RuntimeDeps, events: list[StepEvent]) -> None:
    assert [(event.status, event.call_id) for event in events] == [
        ("running", "call-1"),
        ("done", "call-1"),
    ]
    assert events[0].data == {"title": "君の名は。"}
    assert events[1].data == {"outcome": "resolved"}
    assert deps.steps[0].params == {"title": "君の名は。"}
    assert deps.steps[0].data == {"outcome": "resolved"}


async def test_retry_emits_error_without_persisting_failed_step() -> None:
    deps = _deps()
    retry = RetryPromptPart("try again", tool_name="search_nearby", tool_call_id="r")
    events = await _handle(
        deps,
        _call("search_nearby", "r", {"location": "Uji"}),
        FunctionToolResultEvent(retry),
    )
    assert [event.status for event in events] == ["running", "error"]
    assert events[-1].data == {}
    assert deps.steps == []


async def test_terminal_failed_return_is_persisted_without_exception_detail() -> None:
    deps = _deps()
    events = await _handle(
        deps,
        _call("web_search", "failed", {"query": "x"}),
        _result("web_search", "failed", "provider secret", "failed"),
    )
    _assert_failed(deps, events)
    assert "provider secret" not in str(events[-1].data)


async def test_hook_recovered_exception_emits_error_without_failed_step() -> None:
    deps = _deps()
    deps.tool_lifecycle.mark_recovered_exception("recovered")
    events = await _handle(
        deps,
        _call("future_tool", "recovered", {}),
        _result("future_tool", "recovered", {"error": True}),
    )
    assert events[-1].status == "error"
    assert deps.steps == []


def _assert_failed(deps: RuntimeDeps, events: list[StepEvent]) -> None:
    assert events[-1].status == "error"
    assert (deps.steps[0].success, deps.steps[0].error) == (
        False,
        "Tool execution failed",
    )


async def test_empty_search_uses_exact_registered_provenance() -> None:
    deps = _deps()
    exact = ProducedSearch(outcome="empty", result_ref=ResultRef("search:0:2"))
    deps.tool_lifecycle.register_provenance("empty-call", exact)
    await _handle(
        deps,
        _call("search_bangumi", "empty-call", {"bangumi_id": "1"}),
        _result("search_bangumi", "empty-call", {"outcome": "empty"}),
    )
    assert deps.steps[0].provenance == exact


async def test_parallel_results_join_params_by_call_id() -> None:
    deps = _deps()
    await _handle_parallel(deps)
    assert [(step.params, step.data) for step in deps.steps] == [
        ({"query": "second"}, {"content": "B"}),
        ({"query": "first"}, {"content": "A"}),
    ]


async def _handle_parallel(deps: RuntimeDeps) -> None:
    await _handle(
        deps,
        _call("web_search", "a", {"query": "first"}),
        _call("web_search", "b", {"query": "second"}),
        _result("web_search", "b", "B"),
        _result("web_search", "a", "A"),
    )


async def test_untrusted_string_projection_is_bounded_and_sanitized() -> None:
    deps = _deps()
    events = await _large_result(deps)
    content = events[-1].data["content"]
    assert isinstance(content, str)
    assert len(content) <= 1_024
    assert max(map(len, events[-1].data)) <= 1_024
    assert "\x00" not in content
    assert deps.steps[0].data == events[-1].data


async def _large_result(deps: RuntimeDeps) -> list[StepEvent]:
    content = {"content": "x\x00" * 2_000, "k" * 2_000: "bounded"}
    return await _handle(
        deps,
        _call("translate_anime_title", "large", {"title": "x"}),
        _result("translate_anime_title", "large", content),
    )


async def test_injection_scan_covers_content_beyond_projection_limit() -> None:
    deps = _deps()
    content = "x" * 1_500 + " DROP TABLE routes"
    with testing.capture_logs() as captured:
        events = await _handle(
            deps,
            _call("future_tool", "scan", {}),
            _result("future_tool", "scan", content),
        )
    assert "DROP TABLE" not in str(events[-1].data)
    assert any(event.get("source") == "future_tool" for event in captured)


async def test_interrupted_call_without_result_is_not_persistent() -> None:
    deps = _deps()
    events = await _handle(deps, _call("plan_route", "active", {"ref": "r"}))
    assert [event.status for event in events] == ["running"]
    assert deps.steps == []


async def test_new_function_tool_is_recorded_without_tool_specific_wiring() -> None:
    deps = _deps()
    await _handle(
        deps,
        _call("future_tool", "future-id", {"value": 1}),
        _result("future_tool", "future-id", {"outcome": "ok"}),
    )
    assert [(step.tool, step.params) for step in deps.steps] == [
        ("future_tool", {"value": 1})
    ]
