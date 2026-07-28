"""Container ingress refuses an anonymous stamp carrying a credential (#441).

The edge strips ``Authorization`` before it stamps an identity, so the two can
only arrive together when the edge fell through on a bad credential or was
bypassed. Either way the authoritative tier must 401 rather than serve the turn
as a fresh anonymous visitor on the anonymous meter.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
from fastapi import FastAPI

from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.schemas import PublicAPIResponse
from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

ANON_HEADERS = {
    "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
    "X-User-Type": "anonymous",
}
HUMAN_HEADERS = {"X-User-Id": "user-1", "X-User-Type": "human"}
STALE_JWT = "Bearer eyJhbGciOiJFUzI1NiJ9.stale.signature"


def _body() -> dict[str, object]:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "京吹"}]}
        ]
    }


def _app() -> tuple[FastAPI, MagicMock]:
    db = build_stub_db()
    db.usage = MagicMock()
    db.usage.accumulate_usage = AsyncMock(return_value=None)
    db.usage.total_cost_usd = AsyncMock(return_value=0.0)
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(
            success=True, status="ok", intent="plan_route", message="ルートだよ。"
        )
    )
    runtime.validate_session_owner = AsyncMock(return_value=None)
    runtime._db = db
    app, _ = build_app(runtime_api=runtime, db=db)
    return app, runtime


async def _post(app: FastAPI, headers: dict[str, str]) -> httpx.Response:
    async with async_client(app) as client:
        return await client.post("/v1/chat", json=_body(), headers=headers)


async def test_an_anonymous_stamp_with_a_credential_is_rejected() -> None:
    app, _ = _app()
    response = await _post(app, {**ANON_HEADERS, "Authorization": STALE_JWT})
    assert response.status_code == 401


async def test_the_rejected_turn_never_reaches_the_runtime() -> None:
    app, runtime = _app()
    await _post(app, {**ANON_HEADERS, "Authorization": STALE_JWT})
    assert runtime.handle.await_count == 0


async def test_the_rejection_carries_the_authentication_error_code() -> None:
    app, _ = _app()
    response = await _post(app, {**ANON_HEADERS, "Authorization": STALE_JWT})
    assert response.json()["error"]["code"] == "authentication_error"


async def test_the_rejection_is_logged_without_the_credential() -> None:
    from structlog import testing

    app, _ = _app()
    with testing.capture_logs() as captured:
        await _post(app, {**ANON_HEADERS, "Authorization": STALE_JWT})
    events = [
        entry for entry in captured if entry["event"] == "anonymous_credential_rejected"
    ]
    assert len(events) == 1
    assert STALE_JWT not in str(events[0])


async def test_a_credential_free_anonymous_turn_still_succeeds() -> None:
    app, runtime = _app()
    response = await _post(app, ANON_HEADERS)
    assert response.status_code == 200
    assert runtime.handle.await_count == 1


async def test_a_logged_in_stamp_is_unaffected_by_a_lingering_credential() -> None:
    app, runtime = _app()
    response = await _post(app, {**HUMAN_HEADERS, "Authorization": STALE_JWT})
    assert response.status_code == 200
    assert runtime.handle.await_count == 1
