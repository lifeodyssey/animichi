"""Regression for the OpenCode Go MiMo streaming profile."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import cast
from unittest.mock import MagicMock, patch

import httpx
from pydantic import BaseModel, JsonValue, TypeAdapter
from pydantic_ai import Agent, AgentRunResultEvent, models
from pydantic_ai.messages import (
    AgentStreamEvent,
    FinalResultEvent,
    PartDeltaEvent,
    PartStartEvent,
    ToolCallPart,
    ToolCallPartDelta,
)

from animichi.agents.base import resolve_model
from animichi.agents.runtime_deps import RuntimeDeps, StepEvent
from animichi.agents.tool_event_bridge import tool_event_bridge
from animichi.config.settings import Settings
from animichi.domain.ports import CatalogLookup
from animichi.tests.eval.mock_catalog_client import MockCatalogClient

_PAYLOAD = TypeAdapter(dict[str, JsonValue])
_SPEC = "openai:mimo-v2.5@https://opencode.ai/zen/go/v1"


class ProbeOutput(BaseModel):
    message: str


class _StreamingTransport(httpx.AsyncBaseTransport):
    def __init__(self) -> None:
        self.payloads: list[dict[str, JsonValue]] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        payload = _PAYLOAD.validate_json(request.content)
        self.payloads.append(payload)
        tool_name = _output_tool_name(payload)
        return httpx.Response(
            200,
            content=_tool_stream(tool_name),
            headers={"content-type": "text/event-stream"},
            request=request,
        )


def _output_tool_name(payload: dict[str, JsonValue]) -> str:
    tools = payload["tools"]
    assert isinstance(tools, list) and isinstance(tools[0], dict)
    function = tools[0]["function"]
    assert isinstance(function, dict) and isinstance(function["name"], str)
    return function["name"]


def _chunk(
    delta: dict[str, JsonValue], finish: str | None = None
) -> dict[str, JsonValue]:
    return {
        "id": "chatcmpl-probe",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "mimo-v2.5",
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }


def _tool_stream(tool_name: str) -> bytes:
    start = {
        "role": "assistant",
        "tool_calls": [
            {
                "index": 0,
                "id": "call-probe",
                "type": "function",
                "function": {"name": tool_name, "arguments": '{"message":'},
            }
        ],
    }
    delta = {"tool_calls": [{"index": 0, "function": {"arguments": '"ok"}'}}]}
    chunks = [_chunk(start), _chunk(delta), _chunk({}, "tool_calls")]
    frames = [f"data: {json.dumps(chunk)}\n\n" for chunk in chunks]
    return "".join([*frames, "data: [DONE]\n\n"]).encode()


async def test_opencode_go_streams_typed_output_with_thinking_disabled() -> None:
    settings = Settings(zen_go_api_key="test-key", fallback_agent_model=None)
    transport = _StreamingTransport()
    client = httpx.AsyncClient(transport=transport)
    with (
        patch("animichi.config.get_settings", return_value=settings),
        models.override_allow_model_requests(True),
    ):
        model = resolve_model(_SPEC, http_client=client)
        async with Agent(model, output_type=ProbeOutput).run_stream_events(
            "probe"
        ) as stream:
            events = [event async for event in stream]
    await client.aclose()

    assert transport.payloads[0]["stream"] is True
    assert transport.payloads[0]["thinking"] == {"type": "disabled"}
    assert any(
        isinstance(event, PartStartEvent) and isinstance(event.part, ToolCallPart)
        for event in events
    )
    assert any(
        isinstance(event, PartDeltaEvent) and isinstance(event.delta, ToolCallPartDelta)
        for event in events
    )
    assert any(
        isinstance(event, AgentRunResultEvent)
        and event.result.output == ProbeOutput(message="ok")
        for event in events
    )


async def test_output_tool_start_streams_once_before_final_result() -> None:
    captured: list[StepEvent] = []

    async def capture(event: StepEvent) -> None:
        captured.append(event)

    deps = RuntimeDeps(
        cast(CatalogLookup, object()),
        "en",
        "probe",
        MockCatalogClient(),
        on_step=capture,
    )
    events = _bridge_events("greeting_response")
    await tool_event_bridge(MagicMock(deps=deps), events)
    assert captured == [
        StepEvent("greet_user", "call-probe", "running", {}, kind="output")
    ]


async def _bridge_events(tool_name: str) -> AsyncIterator[AgentStreamEvent]:
    part = ToolCallPart(tool_name, "", tool_call_id="call-probe")
    yield PartStartEvent(index=0, part=part)
    yield FinalResultEvent(tool_name=tool_name, tool_call_id="call-probe")
