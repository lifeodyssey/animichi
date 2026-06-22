"""Unit tests for POST /v1/chat (Vercel AI SDK adapter)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

from starlette.responses import StreamingResponse

from agent.infrastructure.session.memory import InMemorySessionStore
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.schemas import PublicAPIResponse
from agent.tests.unit.conftest_fastapi import (
    async_client,
    build_app,
    build_stub_db,
)


def _vercel_body(
    text: str = "京吹",
    *,
    session_id: str | None = None,
    locale: str = "ja",
) -> dict[str, object]:
    """Build a minimal Vercel AI SDK submit-message body."""
    body: dict[str, object] = {
        "trigger": "submit-message",
        "id": "msg-1",
        "messages": [
            {
                "id": "u1",
                "role": "user",
                "parts": [{"type": "text", "text": text}],
            }
        ],
        "locale": locale,
    }
    if session_id is not None:
        body["session_id"] = session_id
    return body


# ---------------------------------------------------------------------------
# AC 1: Missing X-User-Id returns 400
# ---------------------------------------------------------------------------


async def test_chat_without_user_id_returns_400() -> None:
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/chat",
            content=json.dumps(_vercel_body()),
            headers={"Content-Type": "application/json"},
        )
    assert resp.status_code == 400
    body = resp.json()
    assert "X-User-Id" in body["error"]["message"]


# ---------------------------------------------------------------------------
# AC 2: Valid request returns text/event-stream
# ---------------------------------------------------------------------------


async def test_chat_returns_event_stream() -> None:
    mock_db = build_stub_db()
    runtime = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
    app, _ = build_app(runtime_api=runtime, db=mock_db)

    # Mock dispatch_request to return an SSE streaming response
    with patch(
        "agent.interfaces.routes.chat.VercelAIAdapter.dispatch_request",
        new_callable=AsyncMock,
        return_value=_sse_response(),
    ) as mock_dispatch:
        async with async_client(app) as client:
            resp = await client.post(
                "/v1/chat",
                content=json.dumps(_vercel_body()),
                headers={
                    "Content-Type": "application/json",
                    "X-User-Id": "user-1",
                },
            )

        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")
        # on_complete callback must be passed for DataChunk emission
        call_kwargs = mock_dispatch.call_args.kwargs
        assert callable(call_kwargs["on_complete"])


# ---------------------------------------------------------------------------
# AC 3: Old /v1/runtime/stream still works
# ---------------------------------------------------------------------------


async def test_legacy_runtime_stream_still_registered() -> None:
    mock_runtime = MagicMock(spec=RuntimeAPI)
    mock_runtime.handle = AsyncMock(return_value=_make_response())
    mock_runtime._db = build_stub_db()
    mock_runtime._session_store = InMemorySessionStore()

    app, _ = build_app(runtime_api=mock_runtime)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/runtime/stream",
            json={"text": "京吹の聖地"},
        )
    # Should reach the endpoint (200 from SSE generator)
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# AC 4: Locale normalization — invalid locale defaults to "ja"
# ---------------------------------------------------------------------------


async def test_chat_invalid_locale_defaults_to_ja() -> None:
    mock_db = build_stub_db()
    runtime = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
    app, _ = build_app(runtime_api=runtime, db=mock_db)

    with patch(
        "agent.interfaces.routes.chat.VercelAIAdapter.dispatch_request",
        new_callable=AsyncMock,
        return_value=_sse_response(),
    ):
        async with async_client(app) as client:
            resp = await client.post(
                "/v1/chat",
                content=json.dumps(_vercel_body()),
                headers={
                    "Content-Type": "application/json",
                    "X-User-Id": "user-1",
                    "x-locale": "fr",
                },
            )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# AC 5: Clarify context detection from message history
# ---------------------------------------------------------------------------


class TestDetectClarifyContext:
    def test_empty_body(self) -> None:
        from agent.interfaces.routes.chat import _detect_clarify_context

        assert _detect_clarify_context(b"") == {}

    def test_no_assistant_message(self) -> None:
        from agent.interfaces.routes.chat import _detect_clarify_context

        body = json.dumps(
            {"messages": [{"role": "user", "parts": [{"type": "text", "text": "hi"}]}]}
        ).encode()
        assert _detect_clarify_context(body) == {}

    def test_assistant_without_clarify(self) -> None:
        from agent.interfaces.routes.chat import _detect_clarify_context

        body = json.dumps(
            {
                "messages": [
                    {"role": "user", "parts": [{"type": "text", "text": "京吹"}]},
                    {
                        "role": "assistant",
                        "parts": [{"type": "text", "text": "Here are results"}],
                    },
                    {"role": "user", "parts": [{"type": "text", "text": "more"}]},
                ]
            }
        ).encode()
        assert _detect_clarify_context(body) == {}

    def test_detects_clarify_with_candidates(self) -> None:
        from agent.interfaces.routes.chat import _detect_clarify_context

        body = json.dumps(
            {
                "messages": [
                    {"role": "user", "parts": [{"type": "text", "text": "凉宫"}]},
                    {
                        "role": "assistant",
                        "parts": [
                            {
                                "type": "tool-clarify",
                                "toolName": "clarify",
                                "output": {
                                    "question": "Which one?",
                                    "candidates": [
                                        {
                                            "title": "涼宮ハルヒの憂鬱",
                                            "bangumi_id": "485",
                                        },
                                        {
                                            "title": "涼宮ハルヒの消失",
                                            "bangumi_id": "3375",
                                        },
                                    ],
                                },
                            }
                        ],
                    },
                    {
                        "role": "user",
                        "parts": [{"type": "text", "text": "涼宮ハルヒの憂鬱"}],
                    },
                ]
            }
        ).encode()
        result = _detect_clarify_context(body)
        assert result["pending_clarify"] is True
        assert len(result["resolve_candidates"]) == 2

    def test_detects_clarify_without_output(self) -> None:
        from agent.interfaces.routes.chat import _detect_clarify_context

        body = json.dumps(
            {
                "messages": [
                    {"role": "user", "parts": [{"type": "text", "text": "fate"}]},
                    {
                        "role": "assistant",
                        "parts": [{"type": "tool-clarify", "toolName": "clarify"}],
                    },
                    {
                        "role": "user",
                        "parts": [{"type": "text", "text": "Fate/stay night"}],
                    },
                ]
            }
        ).encode()
        result = _detect_clarify_context(body)
        assert result["pending_clarify"] is True


# ---------------------------------------------------------------------------
# AC 6: _on_complete yields DataChunk for structured output
# ---------------------------------------------------------------------------


class TestOnComplete:
    async def test_yields_data_chunk_with_merged_tool_state(self) -> None:
        from agent.interfaces.routes.chat import _make_on_complete

        mock_deps = MagicMock()
        mock_deps.tool_state = {
            "search_bangumi": {
                "rows": [{"id": "p1", "name": "宇治橋", "city": "宇治"}],
                "row_count": 1,
            }
        }

        mock_output = MagicMock()
        mock_output.model_dump.return_value = {
            "intent": "search_bangumi",
            "message": "Found spots",
            "data": {"results": {"rows": [], "row_count": 0}},
        }
        mock_result = MagicMock()
        mock_result.output = mock_output

        on_complete = _make_on_complete(mock_deps)
        chunks = [chunk async for chunk in on_complete(mock_result)]
        assert len(chunks) == 1
        assert chunks[0].type == "data-response"
        assert chunks[0].data["intent"] == "search_bangumi"
        # Data should be merged from tool_state, wrapped under "results"
        assert len(chunks[0].data["data"]["results"]["rows"]) == 1
        assert chunks[0].data["data"]["results"]["rows"][0]["city"] == "宇治"

    async def test_no_chunk_for_plain_output(self) -> None:
        from agent.interfaces.routes.chat import _make_on_complete

        mock_deps = MagicMock()
        mock_deps.tool_state = {}
        mock_result = MagicMock()
        mock_result.output = "just a string"

        on_complete = _make_on_complete(mock_deps)
        chunks = [chunk async for chunk in on_complete(mock_result)]
        assert len(chunks) == 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sse_response() -> StreamingResponse:
    async def _gen() -> AsyncIterator[str]:
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
    )


def _make_response() -> PublicAPIResponse:
    return PublicAPIResponse(
        success=True,
        status="ok",
        intent="search_bangumi",
        message="Found locations.",
    )
