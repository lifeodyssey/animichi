"""Unit tests for the unified POST /v1/chat boundary."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

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
