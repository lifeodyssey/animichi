"""SSRF-blocked `base_url` -> 400 at the route layer (Fable P2-1, #284 T3).

Split out of `test_byok_chat_routing.py` to stay under the 200-line cap.
This is the one BYOK route test that deliberately does **not** mock
`build_byok_model` — it exercises the real function, so the assertion covers
the SSRF guard (Task 1) reaching all the way through to a route-level 400,
not just the header-shape checks in `parse_byok_credential`.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI

from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.schemas import PublicAPIResponse
from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

pytestmark = pytest.mark.integration

HUMAN_HEADERS = {"X-User-Id": "user-1", "X-User-Type": "human"}


def _body() -> dict[str, object]:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "京吹"}]}
        ]
    }


def _app() -> tuple[FastAPI, MagicMock]:
    db = build_stub_db()
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(
            success=True, status="ok", intent="plan_route", message="ルートだよ。"
        )
    )
    runtime.validate_session_owner = AsyncMock(return_value=None)
    app, _ = build_app(runtime_api=runtime, db=db)
    return app, runtime


async def test_ssrf_blocked_base_url_is_rejected_pre_stream() -> None:
    """A private-IP `base_url` is rejected via the *real* `build_byok_model`
    (not mocked) — a 400 at the route layer, never a silent fallthrough."""
    app, runtime = _app()
    headers = HUMAN_HEADERS | {
        "X-BYOK-Provider": "openai-compatible",
        "X-BYOK-Key": "sk-x",
        "X-BYOK-Model": "byok-test-model",
        "X-BYOK-Base-Url": "https://127.0.0.1/v1",
    }
    async with async_client(app) as client:
        response = await client.post("/v1/chat", json=_body(), headers=headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"
    assert runtime.handle.await_count == 0
