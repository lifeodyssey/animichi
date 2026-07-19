"""Unit tests for the progressive AI SDK UI message stream."""

from __future__ import annotations

import json

from agent.agents.runtime_deps import OnStep, StepEvent
from agent.interfaces.routes.chat_stream import (
    RESPONSE_DATA_ID,
    ChatHandler,
    stream_chat,
)
from agent.interfaces.schemas import PublicAPIResponse


async def _collect(handler: ChatHandler) -> list[str]:
    return [frame async for frame in stream_chat(handler)]


def _parse(frames: list[str]) -> list[object]:
    chunks: list[object] = []
    for frame in frames:
        assert frame.startswith("data: ")
        assert frame.endswith("\n\n")
        body = frame[len("data: ") : -2]
        chunks.append(body if body == "[DONE]" else json.loads(body))
    return chunks


def _type_of(chunk: object) -> str:
    if chunk == "[DONE]":
        return "[DONE]"
    assert isinstance(chunk, dict)
    kind = chunk["type"]
    assert isinstance(kind, str)
    return kind


def _types(chunks: list[object]) -> list[str]:
    return [_type_of(chunk) for chunk in chunks]


def _of_type(chunks: list[object], type_name: str) -> list[dict[str, object]]:
    return [
        chunk
        for chunk in chunks
        if isinstance(chunk, dict) and chunk.get("type") == type_name
    ]


def _response(intent: str = "greet_user") -> PublicAPIResponse:
    return PublicAPIResponse(
        success=True, status="ok", intent=intent, message="hi", data={"k": "v"}
    )


async def _plain_handler(_on_step: OnStep) -> PublicAPIResponse:
    return _response()


def _tool_handler(response: PublicAPIResponse) -> ChatHandler:
    async def handler(on_step: OnStep) -> PublicAPIResponse:
        await on_step(
            StepEvent("resolve_anime", "provider-call-1", "running", {"t": "x"})
        )
        await on_step(StepEvent("resolve_anime", "provider-call-1", "done", {"id": 1}))
        return response

    return handler


async def _failing_handler(_on_step: OnStep) -> PublicAPIResponse:
    raise RuntimeError("boom")


async def _running_then_failing_handler(on_step: OnStep) -> PublicAPIResponse:
    await on_step(StepEvent("search_nearby", "provider-call-error", "running", {}))
    raise RuntimeError("normalization failed")


def _concurrent_tool_handler(response: PublicAPIResponse) -> ChatHandler:
    async def handler(on_step: OnStep) -> PublicAPIResponse:
        await on_step(StepEvent("resolve_anime", "call-a", "running", {"q": "a"}))
        await on_step(StepEvent("resolve_anime", "call-b", "running", {"q": "b"}))
        await on_step(StepEvent("resolve_anime", "call-a", "done", {"id": "a"}))
        await on_step(StepEvent("resolve_anime", "call-b", "done", {"id": "b"}))
        return response

    return handler


async def test_stream_emits_ordered_envelope_for_plain_response() -> None:
    chunks = _parse(await _collect(_plain_handler))
    assert _types(chunks) == [
        "start",
        "start-step",
        "data-response",
        "data-response",
        "finish-step",
        "finish",
        "[DONE]",
    ]


async def test_finish_reason_is_stop_on_success() -> None:
    chunks = _parse(await _collect(_plain_handler))
    assert _of_type(chunks, "finish")[0]["finishReason"] == "stop"


async def test_intent_arrives_before_full_data_part() -> None:
    parts = _of_type(_parse(await _collect(_plain_handler)), "data-response")
    assert parts[0]["data"] == {"intent": "greet_user"}
    full = parts[1]["data"]
    assert isinstance(full, dict)
    assert full["intent"] == "greet_user"
    assert set(full) > {"intent"}


async def test_progressive_data_parts_share_one_id() -> None:
    parts = _of_type(_parse(await _collect(_plain_handler)), "data-response")
    assert [part["id"] for part in parts] == [RESPONSE_DATA_ID, RESPONSE_DATA_ID]


async def test_tool_steps_become_tool_parts_with_stable_call_id() -> None:
    chunks = _parse(await _collect(_tool_handler(_response("search_bangumi"))))
    start = _of_type(chunks, "tool-input-start")[0]
    available = _of_type(chunks, "tool-input-available")[0]
    output = _of_type(chunks, "tool-output-available")[0]
    call_id = start["toolCallId"]
    assert available["toolCallId"] == call_id
    assert output["toolCallId"] == call_id
    assert start["toolName"] == "resolve_anime"
    assert available["input"] == {"t": "x"}
    assert output["output"] == {"id": 1}


async def test_tool_parts_precede_data_parts() -> None:
    order = _types(_parse(await _collect(_tool_handler(_response()))))
    assert order.index("tool-output-available") < order.index("data-response")


async def test_same_named_concurrent_calls_resolve_by_call_id() -> None:
    chunks = _parse(await _collect(_concurrent_tool_handler(_response())))
    inputs = _of_type(chunks, "tool-input-available")
    outputs = _of_type(chunks, "tool-output-available")
    assert [(part["toolCallId"], part["input"]) for part in inputs] == [
        ("call-a", {"q": "a"}),
        ("call-b", {"q": "b"}),
    ]
    assert [(part["toolCallId"], part["output"]) for part in outputs] == [
        ("call-a", {"id": "a"}),
        ("call-b", {"id": "b"}),
    ]


async def test_handler_failure_emits_error_part_not_data() -> None:
    chunks = _parse(await _collect(_failing_handler))
    assert _types(chunks) == [
        "start",
        "start-step",
        "error",
        "finish-step",
        "finish",
        "[DONE]",
    ]
    assert _of_type(chunks, "finish")[0]["finishReason"] == "error"
    assert _of_type(chunks, "data-response") == []


async def test_error_text_does_not_leak_exception_detail() -> None:
    error = _of_type(_parse(await _collect(_failing_handler)), "error")[0]
    assert "boom" not in str(error["errorText"])


async def test_running_call_is_closed_when_handler_raises() -> None:
    chunks = _parse(await _collect(_running_then_failing_handler))
    tool_error = _of_type(chunks, "tool-output-error")
    assert [part["toolCallId"] for part in tool_error] == ["provider-call-error"]
    assert _types(chunks).index("tool-output-error") < _types(chunks).index("error")
