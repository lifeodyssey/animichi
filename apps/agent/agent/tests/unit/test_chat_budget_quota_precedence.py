"""Precedence when the global budget breaker and the per-identity daily
message quota (#282) are both exhausted on the same anonymous turn.

The global dollar breaker (D11, issue #274 X4) protects the whole anonymous
surface and is the more severe, systemic concern; it wins ties over one
visitor's own message ceiling (D12, issue #282). ``chat.py`` checks the
budget first and only falls through to the quota check when the budget
allows the turn.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
from fastapi import FastAPI

from agent.config.settings import Settings
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.schemas import PublicAPIResponse
from agent.interfaces.usage_metering import ANON_BUDGET_EXHAUSTED_CODE
from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

ANON_HEADERS = {
    "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
    "X-User-Type": "anonymous",
}
BUDGET = 5.0
QUOTA = 3


def _body() -> dict[str, object]:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "京吹"}]}
        ]
    }


def _db(*, spent: float, next_count: int) -> MagicMock:
    db = build_stub_db()
    db.usage = MagicMock()
    db.usage.accumulate_usage = AsyncMock(return_value=None)
    db.usage.total_cost_usd = AsyncMock(return_value=spent)
    db.anon_quota = MagicMock()
    db.anon_quota.increment_and_count = AsyncMock(return_value=next_count)
    return db


def _runtime(db: MagicMock) -> MagicMock:
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(
            success=True, status="ok", intent="plan_route", message="ルートだよ。"
        )
    )
    runtime.validate_session_owner = AsyncMock(return_value=None)
    runtime._db = db
    return runtime


async def _post(app: FastAPI, headers: dict[str, str]) -> httpx.Response:
    async with async_client(app) as client:
        return await client.post("/v1/chat", json=_body(), headers=headers)


async def test_both_exhausted_yields_the_budget_code_not_the_quota_code() -> None:
    db = _db(spent=BUDGET, next_count=QUOTA + 1)
    runtime = _runtime(db)
    settings = Settings(
        anon_daily_cost_budget_usd=BUDGET, anon_daily_message_quota=QUOTA
    )
    app, _ = build_app(runtime_api=runtime, db=db, settings=settings)

    response = await _post(app, ANON_HEADERS)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == ANON_BUDGET_EXHAUSTED_CODE
    assert runtime.handle.await_count == 0


async def test_the_budget_short_circuit_never_reaches_the_quota_counter() -> None:
    """The quota repo must not be touched once the budget already rejected."""
    db = _db(spent=BUDGET, next_count=QUOTA + 1)
    runtime = _runtime(db)
    settings = Settings(
        anon_daily_cost_budget_usd=BUDGET, anon_daily_message_quota=QUOTA
    )
    app, _ = build_app(runtime_api=runtime, db=db, settings=settings)

    await _post(app, ANON_HEADERS)

    db.anon_quota.increment_and_count.assert_not_awaited()


async def test_only_quota_exhausted_falls_through_to_the_quota_rejection() -> None:
    from agent.interfaces.anon_quota import ANON_QUOTA_EXHAUSTED_CODE

    db = _db(spent=0.0, next_count=QUOTA + 1)
    runtime = _runtime(db)
    settings = Settings(
        anon_daily_cost_budget_usd=BUDGET, anon_daily_message_quota=QUOTA
    )
    app, _ = build_app(runtime_api=runtime, db=db, settings=settings)

    response = await _post(app, ANON_HEADERS)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == ANON_QUOTA_EXHAUSTED_CODE
