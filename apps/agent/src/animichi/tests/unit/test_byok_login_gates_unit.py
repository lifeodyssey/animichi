"""Unit-level coverage for the BYOK login gates (#741 codecov patch gap).

CI's coverage floor (`.github/workflows/pipeline-agent.yml`) runs only
`agent/tests/unit/` — the integration suite (`agent/tests/integration/`,
where `test_byok_login_gate_ordering.py` and `test_byok_probe.py` already
pin both gates' behaviour end-to-end) never contributes to the uploaded
`coverage.xml`. `chat.py::_byok_login_rejection` and
`byok.py::_probe_login_rejection` were therefore invisible to Codecov's
patch check even though they were already integration-tested: this file
exercises both branches of each gate's `is_anonymous_identity(...) or not
_has_byok_headers(...)` condition at the unit level so the #741 fix has
patch coverage, not just end-to-end coverage.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
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
HUMAN_HEADERS = {"X-User-Id": "user-1", "X-User-Type": "human"}
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
    """`_byok_login_rejection`'s "condition False, fall through to the 403"
    arc — the anon+BYOK combination the login gate exists to catch. The
    integration suite already proves this end to end; this unit-level call
    is what makes it count toward Codecov's patch report."""
    app = _chat_app()
    async with async_client(app) as client:
        response = await client.post(
            "/v1/chat", json=_chat_body(), headers=ANON_HEADERS | BYOK_HEADERS
        )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "byok_requires_login"


async def test_probe_gate_allows_a_logged_in_caller_through(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`_probe_login_rejection`'s "condition True, return None" arc: a
    logged-in caller with no BYOK headers clears the gate and reaches the
    (missing-credential) 400 rather than the 403 login wall."""
    monkeypatch.setenv("MIMO_API_KEY", "test-key")
    db = build_stub_db()
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        response = await client.post("/v1/byok/probe", json={}, headers=HUMAN_HEADERS)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


async def test_probe_gate_rejects_when_anonymous_and_byok_both_true() -> None:
    """`_probe_login_rejection`'s "condition False, fall through to the
    403" arc — same anon+BYOK combination as the chat gate, on the probe
    endpoint. Never resolves a real credential: the gate short-circuits
    first."""
    db = build_stub_db()
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        response = await client.post(
            "/v1/byok/probe", json={}, headers=ANON_HEADERS | BYOK_HEADERS
        )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "byok_requires_login"


async def test_probe_gate_route_never_constructs_a_model_for_the_rejected_caller() -> (
    None
):
    """Belt-and-suspenders companion to the 403 assertion above: an
    anonymous+BYOK caller must never reach `build_byok_model`, mirroring the
    integration suite's `must not resolve a BYOK model` guard."""
    from unittest.mock import patch

    db = build_stub_db()
    app, _ = build_app(db=db)
    with patch(
        "animichi.interfaces.services.byok_probe.build_byok_model",
        AsyncMock(side_effect=AssertionError("must not resolve a BYOK model")),
    ):
        async with async_client(app) as client:
            response: httpx.Response = await client.post(
                "/v1/byok/probe", json={}, headers=ANON_HEADERS | BYOK_HEADERS
            )
    assert response.status_code == 403
