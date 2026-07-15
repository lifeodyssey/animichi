"""Native catalog tool history and overflow guardrails."""

from __future__ import annotations

from typing import cast

from pydantic_ai import Agent, RunContext, ToolReturn
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.tools import ToolDefinition

from agent.agents.animichi_agent import _overflow_capability
from agent.agents.models import ToolName
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.tool_runtime import _catalog_tool_return


def _ctx() -> RunContext[RuntimeDeps]:
    return cast(RunContext[RuntimeDeps], object())


def _payload() -> dict[str, object]:
    return {
        "rows": [
            {
                "name": f"spot-{index}",
                "episode": index,
                "latitude": 35.0 + index,
                "longitude": 135.0 + index,
            }
            for index in range(6)
        ],
        "row_count": 6,
        "status": "ok",
        "metadata": {"anime_title": "Animichi"},
    }


async def test_catalog_tool_history_contains_only_compact_summary() -> None:
    observed: list[ModelRequest] = []
    agent = Agent(FunctionModel(lambda messages, info: ModelResponse(parts=[])))

    @agent.tool_plain
    def search_bangumi() -> ToolReturn[dict[str, object]]:
        return _catalog_tool_return(ToolName.SEARCH_BANGUMI, _payload())

    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        requests = [
            message for message in messages if isinstance(message, ModelRequest)
        ]
        if len(requests) == 1:
            return ModelResponse(parts=[ToolCallPart("search_bangumi", {})])
        observed.append(requests[1])
        return ModelResponse(parts=[TextPart("done")])

    await agent.run("search", model=FunctionModel(respond))

    tool_returns = [
        part for part in observed[0].parts if isinstance(part, ToolReturnPart)
    ]
    assert len(tool_returns) == 1
    summary = cast(dict[str, object], tool_returns[0].content)
    assert summary["row_count"] == 6
    assert len(cast(list[object], summary["preview"])) == 5
    assert "Full data is available" in cast(str, summary["note"])
    assert "latitude" not in repr(observed[0].parts)
    assert "longitude" not in repr(observed[0].parts)


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


async def test_oversized_model_visible_value_is_bounded() -> None:
    capability = _overflow_capability()
    result = ToolReturn("x" * 100_001)
    observed = await capability.after_tool_execute(
        _ctx(),
        call=ToolCallPart("search_bangumi", {}, "call-large"),
        tool_def=ToolDefinition(name="search_bangumi"),
        args={},
        result=result,
    )
    assert isinstance(observed, ToolReturn)
    assert isinstance(observed.return_value, str)
    assert len(observed.return_value) < 100_001
    assert "chars omitted from the middle" in observed.return_value
    assert observed.content is None
