"""Structured-output lifecycle projection into visible Generative UI progress."""

from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import MagicMock

from pydantic_ai.messages import (
    FinalResultEvent,
    PartStartEvent,
    TextPart,
    ToolCallPart,
)

from animichi.agents.agent_result import StepRecord
from animichi.agents.runtime_deps import RuntimeDeps, StepEvent
from animichi.agents.tool_event_bridge import tool_event_bridge
from animichi.tests.eval.mock_catalog_client import MockCatalogClient


def _deps() -> RuntimeDeps:
    return RuntimeDeps(MagicMock(), "en", "query", MockCatalogClient())


async def _stream(*events: object) -> AsyncIterator[object]:
    for event in events:
        yield event


async def _handle(deps: RuntimeDeps, *events: object) -> list[StepEvent]:
    captured: list[StepEvent] = []

    async def capture(event: StepEvent) -> None:
        captured.append(event)

    deps.on_step = capture
    await tool_event_bridge(MagicMock(deps=deps), _stream(*events))
    return captured


async def test_final_output_start_emits_typed_progress_event() -> None:
    events = await _handle(
        _deps(),
        FinalResultEvent(tool_name="greeting_response", tool_call_id="output-call"),
    )

    assert events == [
        StepEvent("greet_user", "output-call", "running", {}, kind="output")
    ]


async def test_output_part_start_is_emitted_once_across_lifecycle() -> None:
    part = ToolCallPart("greeting_response", {}, tool_call_id="output-call")
    events = await _handle(
        _deps(),
        PartStartEvent(index=0, part=part),
        FinalResultEvent(tool_name="greeting_response", tool_call_id="output-call"),
    )

    assert len(events) == 1
    assert events[0].call_id == "output-call"


async def test_non_output_part_start_and_unknown_output_are_ignored() -> None:
    events = await _handle(
        _deps(),
        PartStartEvent(index=0, part=TextPart("working")),
        FinalResultEvent(tool_name="unsupported_response", tool_call_id="unknown"),
    )

    assert events == []


async def test_search_output_uses_latest_successful_search_intent() -> None:
    deps = _deps()
    deps.steps = [
        StepRecord("search_bangumi", True),
        StepRecord("search_nearby", False),
    ]

    events = await _handle(
        deps, FinalResultEvent(tool_name="search_response", tool_call_id="search")
    )

    assert events[0].tool == "search_bangumi"


async def test_route_output_uses_latest_successful_route_intent() -> None:
    deps = _deps()
    deps.steps = [StepRecord("plan_selected", True)]

    events = await _handle(
        deps, FinalResultEvent(tool_name="route_response", tool_call_id="route")
    )

    assert events[0].tool == "plan_selected"


async def test_output_without_provider_call_id_gets_stable_local_id() -> None:
    events = await _handle(
        _deps(), FinalResultEvent(tool_name="qa_response", tool_call_id=None)
    )

    assert events[0].call_id.startswith("output-")
