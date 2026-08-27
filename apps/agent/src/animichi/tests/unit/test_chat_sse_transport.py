"""HTTP-seam tests for the sse-starlette transport (P0 SSE §2.1, W1 #1220).

The swap from a hand-rolled ``StreamingResponse`` to sse-starlette's
``EventSourceResponse`` is proven wire-compatible by the *unmodified*
``test_chat_stream*.py`` / ``test_sse_contract.py`` suites (they still pass
byte-for-byte with the new transport). This file covers what only the new
transport adds: wiring the keepalive-ping interval into ``EventSourceResponse``,
and the no-cache / no-buffering / keep-alive proxy headers.

The actual ping cadence and ``: ping`` wire framing are sse-starlette's own
tested behavior — not re-verified here with a live wall-clock wait. What this
route owns is threading ``_SSE_PING_SECONDS`` into the ``ping=`` kwarg, which
a constructor spy proves without ever needing a real ping to fire.
"""

from __future__ import annotations

from collections.abc import AsyncIterable, Mapping
from typing import Literal, NamedTuple, TypedDict
from unittest.mock import AsyncMock, MagicMock

import pytest
from sse_starlette import EventSourceResponse

from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.routes import chat as chat_module
from animichi.interfaces.schemas import PublicAPIResponse
from animichi.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db


class _WireTextPart(TypedDict):
    type: Literal["text"]
    text: str


class _WireUserMessage(TypedDict):
    id: str
    role: Literal["user"]
    parts: list[_WireTextPart]


class _ChatRequestBody(TypedDict):
    messages: list[_WireUserMessage]


def _body(text: str = "京吹") -> _ChatRequestBody:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": text}]}
        ]
    }


def _ok_runtime() -> MagicMock:
    """A RuntimeAPI whose ``handle()`` succeeds immediately."""
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(
            success=True, status="ok", intent="search_bangumi", message="done"
        )
    )
    runtime._db = build_stub_db()
    return runtime


class _CapturedSseCall(NamedTuple):
    """One ``EventSourceResponse(...)`` construction the route made."""

    headers: Mapping[str, str] | None
    ping: int | None


async def test_ping_interval_is_wired_into_the_sse_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(chat_module, "_SSE_PING_SECONDS", 21)
    captured: list[_CapturedSseCall] = []

    def _recording_event_source_response(
        content: AsyncIterable[bytes],
        *,
        headers: Mapping[str, str] | None = None,
        ping: int | None = None,
    ) -> EventSourceResponse:
        captured.append(_CapturedSseCall(headers=headers, ping=ping))
        return EventSourceResponse(content, headers=headers, ping=ping)

    monkeypatch.setattr(
        chat_module, "EventSourceResponse", _recording_event_source_response
    )
    app, _ = build_app(runtime_api=_ok_runtime())
    async with async_client(app) as client:
        await client.post("/v1/chat", json=_body(), headers={"X-User-Id": "user-1"})

    assert captured == [
        _CapturedSseCall(headers={"x-vercel-ai-ui-message-stream": "v1"}, ping=21)
    ]


async def test_sse_response_carries_the_no_buffering_proxy_headers() -> None:
    app, _ = build_app(runtime_api=_ok_runtime())
    async with async_client(app) as client:
        response = await client.post(
            "/v1/chat", json=_body(), headers={"X-User-Id": "user-1"}
        )
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["connection"] == "keep-alive"
    assert response.headers["x-accel-buffering"] == "no"
    assert response.headers["x-vercel-ai-ui-message-stream"] == "v1"
