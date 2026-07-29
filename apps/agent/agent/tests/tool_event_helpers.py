"""Helpers for direct tool tests that replay official lifecycle events."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import cast
from unittest.mock import MagicMock

from pydantic_ai import RunContext
from pydantic_ai.messages import (
    AgentStreamEvent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ToolCallPart,
    ToolReturnPart,
)

from agent.agents.agent_result import StepData
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.tool_event_bridge import tool_event_bridge

_CALL_ID = "direct-tool-test"


def tool_context(deps: RuntimeDeps) -> RunContext[RuntimeDeps]:
    """Make a direct-call context carrying a stable official call ID."""
    return cast(RunContext[RuntimeDeps], MagicMock(deps=deps, tool_call_id=_CALL_ID))


async def project_tool_result(
    deps: RuntimeDeps, tool: str, params: str | StepData | None, result: object
) -> None:
    """Replay the official call/result pair around an already-executed tool."""
    call = ToolCallPart(tool, params, tool_call_id=_CALL_ID)
    returned = ToolReturnPart(tool, result, tool_call_id=_CALL_ID)
    await tool_event_bridge(MagicMock(deps=deps), _events(call, returned))


async def _events(
    call: ToolCallPart, returned: ToolReturnPart
) -> AsyncIterator[AgentStreamEvent]:
    yield FunctionToolCallEvent(call)
    yield FunctionToolResultEvent(returned)
