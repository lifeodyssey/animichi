"""Unit tests for POST /v1/chat (Vercel AI SDK adapter)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

from starlette.responses import StreamingResponse

from backend.infrastructure.session.memory import InMemorySessionStore
from backend.interfaces.public_api import RuntimeAPI
from backend.interfaces.schemas import PublicAPIResponse
from backend.tests.unit.conftest_fastapi import (
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

    with patch("backend.interfaces.routes.chat.VercelAIAdapter") as adapter_cls:
        mock_adapter = MagicMock()
        adapter_cls.return_value = mock_adapter
        adapter_cls.build_run_input = MagicMock(return_value=MagicMock())

        mock_adapter.run_stream.return_value = _empty_async_gen()
        mock_adapter.streaming_response.return_value = _sse_response()

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
# AC 4: _parse_body extracts session_id and locale
# ---------------------------------------------------------------------------


async def test_parse_body_extracts_session() -> None:
    from backend.interfaces.routes.chat import _parse_body

    raw = json.dumps(_vercel_body(session_id="sess-1")).encode()
    _, session_id, locale = await _parse_body(_FakeRequest(raw))
    assert session_id == "sess-1"
    assert locale == "ja"


# ---------------------------------------------------------------------------
# AC 5: _extract_query extracts last user text
# ---------------------------------------------------------------------------


async def test_extract_query_returns_last_user_text() -> None:
    from backend.interfaces.routes.chat import _extract_query

    body = _vercel_body("hello world")
    result = _extract_query(json.dumps(body).encode())
    assert result == "hello world"


async def test_extract_query_returns_empty_for_no_user() -> None:
    from backend.interfaces.routes.chat import _extract_query

    body = json.dumps({"messages": []}).encode()
    result = _extract_query(body)
    assert result == ""


# ---------------------------------------------------------------------------
# AC 6: _parse_body normalizes locale
# ---------------------------------------------------------------------------


async def test_parse_body_normalizes_invalid_locale() -> None:
    from backend.interfaces.routes.chat import _parse_body

    raw = json.dumps({"locale": "fr", "messages": []}).encode()
    _, _, locale = await _parse_body(_FakeRequest(raw))
    assert locale == "ja"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _empty_async_gen() -> AsyncIterator[object]:
    """Async generator that yields nothing."""
    return
    yield  # pragma: no cover


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


class _FakeRequest:
    """Minimal stand-in implementing _HasBody protocol for unit tests."""

    def __init__(self, body_bytes: bytes) -> None:
        self._body = body_bytes

    async def body(self) -> bytes:
        return self._body
