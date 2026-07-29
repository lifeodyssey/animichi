"""SSE-level `byok_credential_rejected` end-to-end (#284 T3-AC6, P1-3②).

`test_byok_error_taxonomy.py` exercises `_execute_pipeline` directly — the
lightest reach to the new branch. This file goes the other way: a real
`RuntimeAPI` wired into the actual FastAPI app via `/v1/chat`, so the
assertion is on the literal SSE bytes a browser client would receive, not on
an internal method's return value. Only `run_animichi_agent` (the deepest
call in the real pipeline) is mocked, to simulate the caller's own provider
rejecting the credential.

OQ-4 (optional `error_code` on the contract's error chunk): no
`packages/contract/` change was made. `PublicAPIErrorWire.code` (in
`agent/interfaces/chat_wire.py`) is already an untyped `str`, so
`byok_credential_rejected` flows through the existing `data-response` SSE
chunk's `errors[].code` field without a schema change — this is the
documented deviation from doing a zod-enum update on the frontend contract.
"""

from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.models import Model

from agent.agents.byok_models import ByokModel
from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

pytestmark = pytest.mark.integration

_FAKE_KEY = "sk-fake-secret-value-should-never-leak"
HUMAN_HEADERS = {"X-User-Id": "user-1", "X-User-Type": "human"}
BYOK_HEADERS = {
    "X-BYOK-Provider": "openai-compatible",
    "X-BYOK-Key": _FAKE_KEY,
    "X-BYOK-Model": "byok-test-model",
    "X-BYOK-Base-Url": "https://byok.example.test/v1",
}


def _body() -> dict[str, object]:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "京吹"}]}
        ]
    }


def _db_with_session_repo() -> MagicMock:
    """`build_stub_db()` plus a fully-async session repo: `get_session_repo`
    duck-types on `upsert_session` being a coroutine function, and the real
    `RuntimeAPI.handle` pipeline this test exercises also calls
    `create_owned_session`/`upsert_conversation` along the way."""
    db = build_stub_db()
    db.session = AsyncMock()
    return db


async def test_sse_stream_carries_byok_credential_rejected_with_no_key_leak() -> None:
    """A real `RuntimeAPI` turn, provider-rejected 401 deep in the pipeline —
    the SSE frame must carry the typed code and never the submitted key."""
    db = _db_with_session_repo()
    app, _ = build_app(db=db)
    fake_client = AsyncMock(spec=httpx.AsyncClient)
    byok_model = ByokModel(model=cast(Model, object()), client=fake_client)

    with (
        patch(
            "agent.interfaces.routes.chat.build_byok_model",
            AsyncMock(return_value=byok_model),
        ),
        patch(
            "agent.interfaces.public_api.run_animichi_agent",
            new=AsyncMock(side_effect=ModelHTTPError(401, "byok-model")),
        ),
    ):
        async with async_client(app) as client:
            response = await client.post(
                "/v1/chat", json=_body(), headers=HUMAN_HEADERS | BYOK_HEADERS
            )

    assert response.status_code == 200
    body = response.text
    assert '"byok_credential_rejected"' in body
    assert _FAKE_KEY not in body
    fake_client.aclose.assert_awaited_once()
