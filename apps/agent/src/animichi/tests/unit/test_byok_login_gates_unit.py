"""Unit coverage for the chat BYOK login gate."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI

from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.schemas import PublicAPIResponse
from animichi.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

pytestmark = pytest.mark.unit

ANON_HEADERS = {
    "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
    "X-User-Type": "anonymous",
}
BYOK_HEADERS = {
    "X-BYOK-Provider": "openai-compatible",
    "X-BYOK-Key": "sk-fake-secret-value",
    "X-BYOK-Model": "byok-test-model",
    "X-BYOK-Base-Url": "https://byok.example.test/v1",
}


def _chat_body() -> dict[str, object]:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "test"}]}
        ]
    }


def _chat_app() -> FastAPI:
    db = build_stub_db()
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(success=True, status="ok", intent="qa")
    )
    runtime.validate_session_owner = AsyncMock(return_value=None)
    app, _ = build_app(runtime_api=runtime, db=db)
    return app


async def test_chat_gate_rejects_when_anonymous_and_byok_both_true() -> None:
    app = _chat_app()
    async with async_client(app) as client:
        response = await client.post(
            "/v1/chat", json=_chat_body(), headers=ANON_HEADERS | BYOK_HEADERS
        )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "byok_requires_login"
