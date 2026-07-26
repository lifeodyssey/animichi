"""Route-level coverage for official tool-event stream sources."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Mapping
from unittest.mock import AsyncMock, MagicMock

from pydantic_ai.messages import (
    AgentStreamEvent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ToolCallPart,
    ToolReturnPart,
)

from agent.agents.agent_result import StepData
from agent.agents.runtime_deps import OnStep, RuntimeDeps
from agent.agents.tool_event_bridge import tool_event_bridge
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.schemas import PublicAPIResponse
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

_HEADERS = {"X-User-Id": "user-1"}


def _response() -> PublicAPIResponse:
    return PublicAPIResponse(
        success=True, status="ok", intent="general_qa", message="ok"
    )


async def _events(items: list[AgentStreamEvent]) -> AsyncIterator[AgentStreamEvent]:
    for item in items:
        yield item


def _runtime(side_effect: object) -> MagicMock:
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(side_effect=side_effect)
    runtime._db = build_stub_db()
    return runtime


def _chunks(body: str) -> list[dict[str, object] | str]:
    values = [line.removeprefix("data: ") for line in body.splitlines() if line]
    return [value if value == "[DONE]" else json.loads(value) for value in values]


def _parts(body: str, kind: str) -> list[dict[str, object]]:
    return [
        chunk
        for chunk in _chunks(body)
        if isinstance(chunk, dict) and chunk.get("type") == kind
    ]


def _official_events() -> list[AgentStreamEvent]:
    return [
        *_event_pair("web_search", {"query": "KyoAni"}, "result", "web-7"),
        *_event_pair(
            "translate_anime_title",
            {"title": "K-On"},
            {"translated": "けいおん"},
            "title-8",
        ),
    ]


def _event_pair(
    tool: str, args: str | StepData | None, content: object, call_id: str
) -> list[AgentStreamEvent]:
    call = ToolCallPart(tool, args, tool_call_id=call_id)
    result = ToolReturnPart(tool, content, tool_call_id=call_id)
    return [FunctionToolCallEvent(call), FunctionToolResultEvent(result)]


async def _static_handler(
    _request: object, *, user_id: str | None = None, on_step: OnStep | None = None
) -> PublicAPIResponse:
    return _response()


async def _official_handler(
    _request: object, *, user_id: str | None = None, on_step: OnStep | None = None
) -> PublicAPIResponse:
    deps = RuntimeDeps(MagicMock(), "en", "query", MockCatalogClient(), on_step=on_step)
    await tool_event_bridge(MagicMock(deps=deps), _events(_official_events()))
    return _response()


async def _timeout_handler(
    _request: object, *, user_id: str | None = None, on_step: OnStep | None = None
) -> PublicAPIResponse:
    deps = RuntimeDeps(MagicMock(), "en", "query", MockCatalogClient(), on_step=on_step)
    call = ToolCallPart("web_search", {"query": "slow"}, tool_call_id="active-9")
    await tool_event_bridge(
        MagicMock(deps=deps), _events([FunctionToolCallEvent(call)])
    )
    raise TimeoutError


async def _post(runtime: MagicMock, body: Mapping[str, object]) -> str:
    app, _ = build_app(runtime_api=runtime)
    async with async_client(app) as client:
        response = await client.post("/v1/chat", json=body, headers=_HEADERS)
    return response.text


async def test_agent_path_streams_web_and_translate_with_official_ids() -> None:
    body = {"messages": [{"role": "user", "parts": [{"type": "text", "text": "x"}]}]}
    text = await _post(_runtime(_official_handler), body)
    starts = _parts(text, "tool-input-start")
    outputs = _parts(text, "tool-output-available")
    assert [(part["toolName"], part["toolCallId"]) for part in starts] == [
        ("web_search", "web-7"),
        ("translate_anime_title", "title-8"),
    ]
    assert [part["toolCallId"] for part in outputs] == ["web-7", "title-8"]


async def test_deterministic_selection_paths_keep_identical_stream_bytes() -> None:
    runtime = _runtime(_static_handler)
    points = await _post(runtime, {"messages": [], "selected_point_ids": ["p1"]})
    candidates = await _post(
        runtime,
        {"messages": [], "selected_candidate_ids": ["1"], "clarification_id": 2},
    )
    assert points.encode() == candidates.encode()


async def test_timeout_closes_officially_active_tool_part() -> None:
    body = {"messages": [{"role": "user", "parts": [{"type": "text", "text": "x"}]}]}
    text = await _post(_runtime(_timeout_handler), body)
    errors = _parts(text, "tool-output-error")
    assert [part["toolCallId"] for part in errors] == ["active-9"]
    assert text.index("tool-output-error") < text.index('"type":"error"')
