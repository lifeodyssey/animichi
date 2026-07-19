"""Terminal-state regressions for the progressive chat stream."""

from __future__ import annotations

import asyncio
import json
from typing import cast
from unittest.mock import MagicMock

from agent.agents.animichi_runner import _record_terminal_clarify
from agent.agents.runtime_deps import OnStep, RuntimeDeps, StepEvent
from agent.agents.runtime_models import ClarifyResponseModel
from agent.interfaces.routes.chat_stream import ChatHandler, stream_chat
from agent.interfaces.schemas import JsonObject, PublicAPIResponse
from agent.tests.eval.mock_catalog_client import MockCatalogClient


async def _collect(handler: ChatHandler) -> list[str]:
    return [frame async for frame in stream_chat(handler)]


def _parse(frames: list[str]) -> list[dict[str, object] | str]:
    values = [frame.removeprefix("data: ").removesuffix("\n\n") for frame in frames]
    return [value if value == "[DONE]" else json.loads(value) for value in values]


def _parts(chunks: list[dict[str, object] | str], kind: str) -> list[dict[str, object]]:
    return [
        chunk
        for chunk in chunks
        if isinstance(chunk, dict) and chunk.get("type") == kind
    ]


def _types(chunks: list[dict[str, object] | str]) -> list[str]:
    return [chunk if isinstance(chunk, str) else str(chunk["type"]) for chunk in chunks]


async def _normalized_failure(on_step: OnStep) -> PublicAPIResponse:
    await on_step(StepEvent("search_nearby", "normalized-call", "running", {}))
    return PublicAPIResponse(success=False, status="timeout", intent="error")


async def _clarification(on_step: OnStep) -> PublicAPIResponse:
    deps = _clarification_deps(on_step)
    output = ClarifyResponseModel(
        reason="anime_not_found", message="Which?", candidate_ids=[]
    )
    await _record_terminal_clarify(deps, output)
    return PublicAPIResponse(
        success=True, status="needs_clarification", intent="clarify"
    )


def _clarification_deps(on_step: OnStep) -> RuntimeDeps:
    return RuntimeDeps(
        db=MagicMock(),
        locale="en",
        query="x",
        catalog=MockCatalogClient(),
        on_step=on_step,
    )


async def _non_serializable(_on_step: OnStep) -> PublicAPIResponse:
    return PublicAPIResponse.model_construct(
        success=True,
        status="ok",
        intent="greet_user",
        session=cast(JsonObject, {"bad": object()}),
    )


async def test_normalized_failure_closes_tools_and_finishes_as_error() -> None:
    chunks = _parse(await _collect(_normalized_failure))
    types = _types(chunks)
    assert types.index("tool-output-error") < types.index("data-response")
    assert _parts(chunks, "finish")[0]["finishReason"] == "error"
    data = _parts(chunks, "data-response")[-1]["data"]
    assert isinstance(data, dict)
    assert data["intent"] == "error"


async def test_clarification_emits_complete_tool_lifecycle() -> None:
    chunks = _parse(await _collect(_clarification))
    kinds = ("tool-input-start", "tool-input-available", "tool-output-available")
    parts = [_parts(chunks, kind)[0] for kind in kinds]
    assert {part["toolCallId"] for part in parts} == {parts[0]["toolCallId"]}


async def test_non_serializable_response_does_not_hang_stream() -> None:
    chunks = _parse(await asyncio.wait_for(_collect(_non_serializable), timeout=1))
    assert _types(chunks)[-1] == "[DONE]"
    assert _parts(chunks, "finish")[0]["finishReason"] == "error"
