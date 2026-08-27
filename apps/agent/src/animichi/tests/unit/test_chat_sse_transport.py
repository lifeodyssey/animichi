"""HTTP-seam tests for the sse-starlette transport (P0 SSE §2.1, W1 #1220).

The swap from a hand-rolled ``StreamingResponse`` to sse-starlette's
``EventSourceResponse`` is proven wire-compatible by the *unmodified*
``test_chat_stream*.py`` / ``test_sse_contract.py`` suites (they still pass
byte-for-byte with the new transport). This file covers what only the new
transport adds: a keepalive ping during long tool calls, and the no-cache /
no-buffering / keep-alive proxy headers.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.routes import chat as chat_module
from animichi.interfaces.schemas import PublicAPIResponse
from animichi.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db


def _body(text: str = "京吹") -> dict[str, object]:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": text}]}
        ]
    }


def _slow_runtime(delay: float) -> MagicMock:
    """A RuntimeAPI whose ``handle()`` outlasts the ping interval — stands in
    for a slow catalog tool call (the audit's catalog budget is 80-85s)."""
    runtime = MagicMock(spec=RuntimeAPI)

    async def _handle(*_args: object, **_kwargs: object) -> PublicAPIResponse:
        await asyncio.sleep(delay)
        return PublicAPIResponse(
            success=True, status="ok", intent="search_bangumi", message="done"
        )

    runtime.handle = AsyncMock(side_effect=_handle)
    runtime._db = build_stub_db()
    return runtime


async def test_ping_frame_appears_during_a_slow_tool_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(chat_module, "_SSE_PING_SECONDS", 0.05)
    runtime = _slow_runtime(delay=0.3)
    app, _ = build_app(runtime_api=runtime)
    async with async_client(app) as client:
        async with client.stream(
            "POST", "/v1/chat", json=_body(), headers={"X-User-Id": "user-1"}
        ) as response:
            raw = b""
            async for chunk in response.aiter_bytes():
                raw += chunk
    lines = raw.split(b"\n")
    assert any(line.startswith(b": ping") for line in lines)


async def test_sse_response_carries_the_no_buffering_proxy_headers() -> None:
    runtime = _slow_runtime(delay=0.0)
    app, _ = build_app(runtime_api=runtime)
    async with async_client(app) as client:
        response = await client.post(
            "/v1/chat", json=_body(), headers={"X-User-Id": "user-1"}
        )
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["connection"] == "keep-alive"
    assert response.headers["x-accel-buffering"] == "no"
    assert response.headers["x-vercel-ai-ui-message-stream"] == "v1"
