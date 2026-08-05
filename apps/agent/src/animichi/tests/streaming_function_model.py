"""FunctionModel adapter for runner tests that consume official event streams."""

from __future__ import annotations

import inspect
from collections.abc import AsyncIterator, Awaitable, Callable

from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import (
    AgentInfo,
    DeltaToolCall,
    DeltaToolCalls,
    FunctionModel,
)
from pydantic_ai.profiles import ModelProfile

ResponseFunction = Callable[
    [list[ModelMessage], AgentInfo], ModelResponse | Awaitable[ModelResponse]
]


def streaming_function_model(
    function: ResponseFunction, *, profile: ModelProfile | None = None
) -> FunctionModel:
    async def stream(
        messages: list[ModelMessage], info: AgentInfo
    ) -> AsyncIterator[str | DeltaToolCalls]:
        response = function(messages, info)
        resolved = await response if inspect.isawaitable(response) else response
        for index, part in enumerate(resolved.parts):
            yield _delta(index, part)

    return FunctionModel(function, stream_function=stream, profile=profile)


def _delta(index: int, part: object) -> str | DeltaToolCalls:
    if isinstance(part, TextPart):
        return part.content
    if isinstance(part, ToolCallPart):
        call = DeltaToolCall(
            part.tool_name, part.args_as_json_str(), tool_call_id=part.tool_call_id
        )
        return {index: call}
    raise AssertionError(f"Unsupported FunctionModel test part: {type(part).__name__}")
