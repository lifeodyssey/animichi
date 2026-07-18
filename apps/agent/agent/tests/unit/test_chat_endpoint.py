"""Unit tests for the unified POST /v1/chat boundary."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.agents.runtime_deps import OnStep, StepEvent
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.schemas import PublicAPIResponse
from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db


def _body(text: str = "京吹") -> dict[str, object]:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": text}]}
        ]
    }


def _runtime() -> MagicMock:
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(
            success=True,
            status="ok",
            intent="search_bangumi",
            message="Found locations.",
            data={"results": {"rows": [{"id": "p1"}]}},
        )
    )
    runtime._db = build_stub_db()
    return runtime


async def test_chat_requires_trusted_user() -> None:
    app, _ = build_app(runtime_api=_runtime())
    async with async_client(app) as client:
        response = await client.post("/v1/chat", json=_body())
    assert response.status_code == 400


async def test_chat_routes_through_runtime_and_keeps_vercel_envelope() -> None:
    runtime = _runtime()
    app, _ = build_app(runtime_api=runtime)
    async with async_client(app) as client:
        response = await client.post(
            "/v1/chat",
            json=_body(),
            headers={
                "X-User-Id": "user-1",
                "X-Session-Id": "session-7",
                "X-Locale": "zh",
            },
        )
    assert response.status_code == 200
    assert response.headers["x-vercel-ai-ui-message-stream"] == "v1"
    request = runtime.handle.await_args.args[0]
    assert request.text == "京吹"
    assert request.session_id == "session-7"
    assert request.locale == "zh"
    assert runtime.handle.await_args.kwargs["user_id"] == "user-1"
    assert '"type":"data-response"' in response.text
    assert '"results":{"rows":[{"id":"p1"}]}' in response.text


async def test_chat_selection_uses_explicit_ids_and_server_session() -> None:
    runtime = _runtime()
    app, _ = build_app(runtime_api=runtime)
    body = {
        "messages": [],
        "selected_candidate_ids": ["115908", "117696"],
        "clarification_id": 4,
    }
    async with async_client(app) as client:
        response = await client.post(
            "/v1/chat",
            json=body,
            headers={"X-User-Id": "user-1", "X-Session-Id": "session-4"},
        )
    assert response.status_code == 200
    request = runtime.handle.await_args.args[0]
    assert request.text == ""
    assert request.selected_candidate_ids == ["115908", "117696"]
    assert request.clarification_id == 4
    assert request.session_id == "session-4"


async def test_chat_forwards_named_and_coordinate_origin() -> None:
    runtime = _runtime()
    app, _ = build_app(runtime_api=runtime)
    body = {
        **_body("near me"),
        "origin": "Kyoto Station",
        "origin_lat": 34.9858,
        "origin_lng": 135.7588,
    }
    async with async_client(app) as client:
        response = await client.post(
            "/v1/chat", json=body, headers={"X-User-Id": "user-1"}
        )
    assert response.status_code == 200
    request = runtime.handle.await_args.args[0]
    assert request.origin == "Kyoto Station"
    assert request.origin_lat == pytest.approx(34.9858)
    assert request.origin_lng == pytest.approx(135.7588)


async def test_chat_rejects_boolean_clarification_revision() -> None:
    runtime = _runtime()
    app, _ = build_app(runtime_api=runtime)
    body = {
        "messages": [],
        "selected_candidate_ids": ["115908"],
        "clarification_id": True,
    }
    async with async_client(app) as client:
        response = await client.post(
            "/v1/chat",
            json=body,
            headers={"X-User-Id": "user-1", "X-Session-Id": "session-4"},
        )
    assert response.status_code == 422
    runtime.handle.assert_not_awaited()


async def test_chat_does_not_reconstruct_pending_from_assistant_parts() -> None:
    runtime = _runtime()
    app, _ = build_app(runtime_api=runtime)
    body = {
        "messages": [
            {
                "role": "assistant",
                "parts": [{"type": "tool-clarify", "output": {"candidates": ["x"]}}],
            },
            {"role": "user", "parts": [{"type": "text", "text": "first one"}]},
        ]
    }
    async with async_client(app) as client:
        response = await client.post(
            "/v1/chat",
            json=body,
            headers={"X-User-Id": "user-1", "X-Session-Id": "session-4"},
        )
    assert response.status_code == 200
    request = runtime.handle.await_args.args[0]
    assert request.text == "first one"
    assert request.selected_candidate_ids is None


async def test_chat_invalid_locale_defaults_to_ja() -> None:
    runtime = _runtime()
    app, _ = build_app(runtime_api=runtime)
    async with async_client(app) as client:
        await client.post(
            "/v1/chat",
            json=_body(),
            headers={"X-User-Id": "user-1", "X-Locale": "fr"},
        )
    assert runtime.handle.await_args.args[0].locale == "ja"


class _StepRuntime:
    """Runtime double that replays step events before returning a response."""

    def __init__(
        self, response: PublicAPIResponse, steps: list[StepEvent] | None = None
    ) -> None:
        self._response = response
        self._steps = steps or []
        self._db = build_stub_db()

    async def handle(
        self, request: object, *, user_id: str | None = None, on_step: OnStep = ...
    ) -> PublicAPIResponse:
        for step in self._steps:
            if on_step is not ...:
                await on_step(step)
        return self._response


def _frame_types(body: str) -> list[str]:
    types: list[str] = []
    for line in body.splitlines():
        if not line.startswith("data: "):
            continue
        payload = line[len("data: ") :]
        types.append("[DONE]" if payload == "[DONE]" else json.loads(payload)["type"])
    return types


async def test_chat_stream_frame_structure_and_header() -> None:
    steps = [
        StepEvent(tool="resolve_anime", status="running", data={}),
        StepEvent(tool="resolve_anime", status="done", data={"bangumi_id": 1}),
    ]
    runtime = _StepRuntime(_runtime().handle.return_value, steps)
    app, _ = build_app(runtime_api=runtime)  # type: ignore[arg-type]
    async with async_client(app) as client:
        response = await client.post(
            "/v1/chat", json=_body(), headers={"X-User-Id": "user-1"}
        )
    assert response.headers["x-vercel-ai-ui-message-stream"] == "v1"
    types = _frame_types(response.text)
    assert types[:2] == ["start", "start-step"]
    assert types[-1] == "[DONE]"
    assert "tool-input-start" in types
    assert "tool-output-available" in types
    assert types.index("tool-output-available") < types.index("data-response")


async def test_chat_stream_emits_error_part_when_handle_fails() -> None:
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(side_effect=RuntimeError("db down"))
    runtime._db = build_stub_db()
    app, _ = build_app(runtime_api=runtime)
    async with async_client(app) as client:
        response = await client.post(
            "/v1/chat", json=_body(), headers={"X-User-Id": "user-1"}
        )
    assert response.status_code == 200
    assert '"type":"error"' in response.text
    assert "db down" not in response.text
    assert '"type":"data-response"' not in response.text


async def test_chat_partial_response_completes_as_data_response() -> None:
    runtime = _runtime()
    runtime.handle.return_value = PublicAPIResponse(
        success=False,
        status="partial",
        intent="partial",
        message="Partial results are shown.",
        data={},
        ui={"component": "GeneralAnswer"},
    )
    app, _ = build_app(runtime_api=runtime)
    async with async_client(app) as client:
        response = await client.post(
            "/v1/chat",
            json=_body(),
            headers={"X-User-Id": "user-1"},
        )
    assert response.status_code == 200
    assert '"type":"data-response"' in response.text
    assert '"status":"partial"' in response.text
    assert '"type":"error"' not in response.text
