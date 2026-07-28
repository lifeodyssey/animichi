"""#443: recorded tool params must never silently degrade into empty args.

The eval repeat tripwire compares recorded step params. A step whose params were
lost must say so, otherwise two calls with *different* arguments both project to
`{}` and read as one repeated identical call.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import MagicMock

from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ToolCallPart,
    ToolReturnPart,
)

from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.tool_event_bridge import tool_event_bridge
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def _deps() -> RuntimeDeps:
    return RuntimeDeps(MagicMock(), "en", "query", MockCatalogClient())


async def _stream(*events: object) -> AsyncIterator[object]:
    for event in events:
        yield event


async def _handle(deps: RuntimeDeps, *events: object) -> None:
    await tool_event_bridge(MagicMock(deps=deps), _stream(*events))


def _call(tool: str, call_id: str, args: object) -> FunctionToolCallEvent:
    return FunctionToolCallEvent(ToolCallPart(tool, args, tool_call_id=call_id))


def _result(tool: str, call_id: str) -> FunctionToolResultEvent:
    part = ToolReturnPart(tool, {"outcome": "ok"}, tool_call_id=call_id)
    return FunctionToolResultEvent(part)


async def test_marks_params_recorded_when_arguments_are_projected() -> None:
    deps = _deps()
    await _handle(
        deps,
        _call("search_nearby", "c1", {"location": "Uji"}),
        _result("search_nearby", "c1"),
    )
    assert deps.steps[0].params_recorded is True


async def test_marks_params_unrecorded_when_no_call_event_was_seen() -> None:
    """A return whose call event never arrived has no arguments to report."""
    deps = _deps()
    await _handle(deps, _result("search_nearby", "orphan"))
    assert (deps.steps[0].params, deps.steps[0].params_recorded) == ({}, False)


async def test_marks_params_unrecorded_when_arguments_are_not_projectable() -> None:
    deps = _deps()
    await _handle(
        deps,
        _call("search_nearby", "c2", {"radius_m": {"not", "json"}}),
        _result("search_nearby", "c2"),
    )
    assert (deps.steps[0].params, deps.steps[0].params_recorded) == ({}, False)


async def test_keeps_distinct_arguments_distinct_across_rejected_retries() -> None:
    """The #443 trajectory: place resolution fails, the model retries a new spelling."""
    deps = _deps()
    await _handle(
        deps,
        _call("search_nearby", "a", {"location": "Nishinomiya, Japan"}),
        _result("search_nearby", "a"),
        _call("search_nearby", "b", {"location": "西宮市"}),
        _result("search_nearby", "b"),
    )
    assert [step.params for step in deps.steps] == [
        {"location": "Nishinomiya, Japan"},
        {"location": "西宮市"},
    ]
