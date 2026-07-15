"""Native ToolReturn separation and overflow guardrails."""

from __future__ import annotations

import json
from typing import cast

from pydantic_ai import RunContext, ToolReturn
from pydantic_ai.messages import ToolCallPart
from pydantic_ai.tools import ToolDefinition

from agent.agents.animichi_agent import _overflow_capability
from agent.agents.models import ToolName
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.tool_runtime import _catalog_tool_return


def _ctx() -> RunContext[RuntimeDeps]:
    return cast(RunContext[RuntimeDeps], object())


def _payload() -> dict[str, object]:
    return {
        "rows": [{"name": f"spot-{index}", "episode": index} for index in range(6)],
        "row_count": 6,
        "status": "ok",
        "metadata": {"anime_title": "Animichi"},
    }


def test_catalog_tool_return_keeps_full_value_and_compact_model_content() -> None:
    payload = _payload()
    result = _catalog_tool_return(ToolName.SEARCH_BANGUMI, payload)
    assert result.return_value is payload
    assert isinstance(result.content, str)
    summary = json.loads(result.content)
    assert summary["row_count"] == 6
    assert len(summary["preview"]) == 5
    assert "Full data is available" in summary["note"]


async def test_normal_catalog_payload_does_not_trigger_overflow() -> None:
    capability = _overflow_capability()
    result = _catalog_tool_return(ToolName.SEARCH_BANGUMI, _payload())
    observed = await capability.after_tool_execute(
        _ctx(),
        call=ToolCallPart("search_bangumi", {}, "call-normal"),
        tool_def=ToolDefinition(name="search_bangumi"),
        args={},
        result=result,
    )
    assert observed is result


async def test_oversized_model_content_is_bounded_without_touching_value() -> None:
    capability = _overflow_capability()
    payload = {"row_count": 1}
    result = ToolReturn(payload, content="x" * 100_001)
    observed = await capability.after_tool_execute(
        _ctx(),
        call=ToolCallPart("search_bangumi", {}, "call-large"),
        tool_def=ToolDefinition(name="search_bangumi"),
        args={},
        result=result,
    )
    assert isinstance(observed, ToolReturn)
    assert observed.return_value is payload
    assert isinstance(observed.content, str)
    assert len(observed.content) < 100_001
    assert "chars omitted from the middle" in observed.content
