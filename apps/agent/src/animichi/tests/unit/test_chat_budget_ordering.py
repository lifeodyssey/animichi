"""Admission ordering on POST /v1/chat (TURN-2 #949).

The anonymous budget breaker (D11) and the per-identity quota (D12) now run
inside :class:`TurnAdmission`. Their ordering guarantees: budget exhaustion
never reaches the quota counter, and any admission rejection happens before a
BYOK model is ever resolved or the runtime is invoked — a rejected caller must
not consume quota, spawn a credential, or cost the provider.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from fastapi import FastAPI

from animichi.config.settings import Settings
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.schemas import PublicAPIResponse
from animichi.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

ANON_HEADERS = {
    "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
    "X-User-Type": "anonymous",
}
BYOK_HEADERS = {
    "X-BYOK-Provider": "anthropic",
    "X-BYOK-Key": "sk-fake-secret-value",
}
BUDGET = 5.0


def _body() -> dict[str, object]:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "京吹"}]}
        ]
    }


def _db(spent: float) -> MagicMock:
    db = build_stub_db()
    db.usage = MagicMock()
    db.usage.accumulate_usage = AsyncMock(return_value=None)
    db.usage.total_cost_usd = AsyncMock(return_value=spent)
    return db


def _app(spent: float) -> tuple[FastAPI, MagicMock]:
    db = _db(spent)
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(success=True, status="ok", intent="general_qa")
    )
    runtime.validate_session_owner = AsyncMock(return_value=None)
    runtime._db = db
    settings = Settings(anon_daily_cost_budget_usd=BUDGET)
    app, _ = build_app(runtime_api=runtime, db=db, settings=settings)
    return app, runtime


async def _post(app: FastAPI, headers: dict[str, str]) -> httpx.Response:
    async with async_client(app) as client:
        return await client.post("/v1/chat", json=_body(), headers=headers)


async def test_an_anonymous_byok_caller_is_rejected_before_byok_resolution() -> None:
    """An anonymous caller with BYOK headers is gated by the BYOK login gate
    (which precedes the budget breaker, matching the pre-TURN-2 ordering),
    and a BYOK model is never resolved for them."""
    app, runtime = _app(spent=BUDGET)
    with patch(
        "animichi.interfaces.routes.chat.build_byok_model",
        AsyncMock(side_effect=AssertionError("must not resolve a BYOK model")),
    ):
        response = await _post(app, ANON_HEADERS | BYOK_HEADERS)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "byok_requires_login"
    assert runtime.handle.await_count == 0


async def test_budget_exhaustion_never_reaches_the_quota_counter() -> None:
    db = _db(spent=BUDGET)
    db.anon_quota = MagicMock()
    db.anon_quota.increment_and_count = AsyncMock(return_value=1)
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(success=True, status="ok", intent="general_qa")
    )
    runtime.validate_session_owner = AsyncMock(return_value=None)
    runtime._db = db
    settings = Settings(anon_daily_cost_budget_usd=BUDGET)
    app, _ = build_app(runtime_api=runtime, db=db, settings=settings)

    response = await _post(app, ANON_HEADERS)
    assert response.status_code == 403
    db.anon_quota.increment_and_count.assert_not_awaited()
    assert runtime.handle.await_count == 0


async def test_admission_precedes_runtime() -> None:
    """An admitted turn reaches the runtime exactly once after passing
    admission — the runtime is the last thing admission orders."""
    app, runtime = _app(spent=0.0)
    response = await _post(app, ANON_HEADERS)
    assert response.status_code == 200
    assert runtime.handle.await_count == 1
