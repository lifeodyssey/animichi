"""Container-ingress anonymous budget breaker on POST /v1/chat (issue #274)."""

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
HUMAN_HEADERS = {"X-User-Id": "user-1", "X-User-Type": "human"}
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


def _app(spent: float, budget: float = BUDGET) -> tuple[FastAPI, MagicMock]:
    db = _db(spent)
    runtime = _runtime(db)
    settings = Settings(anon_daily_cost_budget_usd=budget)
    app, _ = build_app(runtime_api=runtime, db=db, settings=settings)
    return app, runtime


async def _post(app: FastAPI, headers: dict[str, str]) -> httpx.Response:
    async with async_client(app) as client:
        return await client.post("/v1/chat", json=_body(), headers=headers)


async def test_a_brand_new_anonymous_session_with_zero_usage_is_allowed() -> None:
    app, _ = _app(spent=0.0)
    response = await _post(app, ANON_HEADERS)
    assert response.status_code == 200


async def test_the_anonymous_turn_reaches_the_runtime_tagged_anonymous() -> None:
    app, runtime = _app(spent=0.0)
    await _post(app, ANON_HEADERS)
    assert runtime.handle.await_args.kwargs["user_type"] == "anonymous"


async def test_reaching_the_budget_rejects_the_anonymous_turn() -> None:
    app, runtime = _app(spent=BUDGET)
    response = await _post(app, ANON_HEADERS)
    assert response.status_code == 403
    assert runtime.handle.await_count == 0


async def test_the_rejection_guides_the_visitor_toward_login() -> None:
    app, _ = _app(spent=BUDGET + 1.0)
    response = await _post(app, ANON_HEADERS)
    error = response.json()["error"]
    assert error["code"] == ANON_BUDGET_EXHAUSTED_CODE
    assert error["action"] == "login"


async def test_logged_in_users_are_unaffected_by_the_exhausted_budget() -> None:
    app, runtime = _app(spent=BUDGET * 10)
    response = await _post(app, HUMAN_HEADERS)
    assert response.status_code == 200
    assert runtime.handle.await_count == 1


async def test_an_unconfigured_budget_never_rejects_anonymous_turns() -> None:
    app, _ = _app(spent=99.0, budget=0.0)
    response = await _post(app, ANON_HEADERS)
    assert response.status_code == 200
