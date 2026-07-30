"""Container-ingress per-identity daily message quota on POST /v1/chat (#282)."""

from __future__ import annotations

import re
from unittest.mock import AsyncMock, MagicMock

import httpx
from fastapi import FastAPI

from agent.config.settings import Settings
from agent.interfaces.anon_quota import ANON_QUOTA_EXHAUSTED_CODE
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.schemas import PublicAPIResponse
from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

ANON_HEADERS = {
    "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
    "X-User-Type": "anonymous",
}
OTHER_ANON_HEADERS = {
    "X-User-Id": "anon_fedcba9876543210fedcba9876543210",
    "X-User-Type": "anonymous",
}
HUMAN_HEADERS = {"X-User-Id": "user-1", "X-User-Type": "human"}
QUOTA = 3


def _body() -> dict[str, object]:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "京吹"}]}
        ]
    }


def _db(*, next_count: int) -> MagicMock:
    db = build_stub_db()
    db.usage = MagicMock()
    db.usage.accumulate_usage = AsyncMock(return_value=None)
    db.usage.total_cost_usd = AsyncMock(return_value=0.0)
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


def _app(
    *, next_count: int, quota: int | None = QUOTA
) -> tuple[FastAPI, MagicMock, MagicMock]:
    db = _db(next_count=next_count)
    runtime = _runtime(db)
    settings = Settings(anon_daily_message_quota=quota)
    app, _ = build_app(runtime_api=runtime, db=db, settings=settings)
    return app, runtime, db


async def _post(app: FastAPI, headers: dict[str, str]) -> httpx.Response:
    async with async_client(app) as client:
        return await client.post("/v1/chat", json=_body(), headers=headers)


async def test_a_brand_new_anonymous_identity_starts_at_full_quota_not_zero() -> None:
    app, runtime, db = _app(next_count=1)
    response = await _post(app, ANON_HEADERS)
    assert response.status_code == 200
    assert runtime.handle.await_count == 1
    db.anon_quota.increment_and_count.assert_awaited_once()


async def test_the_nth_message_within_quota_still_passes() -> None:
    app, runtime, _ = _app(next_count=QUOTA)
    response = await _post(app, ANON_HEADERS)
    assert response.status_code == 200
    assert runtime.handle.await_count == 1


async def test_the_n_plus_first_message_is_rejected() -> None:
    app, runtime, _ = _app(next_count=QUOTA + 1)
    response = await _post(app, ANON_HEADERS)
    assert response.status_code == 403
    assert runtime.handle.await_count == 0


async def test_the_rejection_carries_the_wire_contract_the_frontend_expects() -> None:
    app, _, _ = _app(next_count=QUOTA + 1)
    response = await _post(app, ANON_HEADERS)
    error = response.json()["error"]
    assert error["code"] == ANON_QUOTA_EXHAUSTED_CODE
    assert error["action"] == "login"


async def test_the_rejection_carries_an_iso_utc_reset_instant_under_data() -> None:
    """`quota_resets_at` nests under `error.data` — the contract's
    `AnonLimitErrorEnvelope` only the quota rejection populates `data`."""
    app, _, _ = _app(next_count=QUOTA + 1)
    response = await _post(app, ANON_HEADERS)
    error = response.json()["error"]
    resets_at = error["data"]["quota_resets_at"]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T00:00:00Z", resets_at)


async def test_the_rejection_has_no_top_level_quota_resets_at() -> None:
    """The field lives under `data`, not flattened onto `error` itself."""
    app, _, _ = _app(next_count=QUOTA + 1)
    response = await _post(app, ANON_HEADERS)
    assert "quota_resets_at" not in response.json()["error"]


async def test_the_counter_is_keyed_per_identity_not_globally() -> None:
    """A different anon identity gets its own count from the repo call args."""
    app, runtime, db = _app(next_count=1)
    await _post(app, ANON_HEADERS)
    await _post(app, OTHER_ANON_HEADERS)
    seen_ids = {
        call.kwargs["anon_id"]
        for call in db.anon_quota.increment_and_count.await_args_list
    }
    assert seen_ids == {ANON_HEADERS["X-User-Id"], OTHER_ANON_HEADERS["X-User-Id"]}
    assert runtime.handle.await_count == 2


async def test_logged_in_users_are_never_quota_checked() -> None:
    app, runtime, db = _app(next_count=QUOTA + 100)
    response = await _post(app, HUMAN_HEADERS)
    assert response.status_code == 200
    assert runtime.handle.await_count == 1
    db.anon_quota.increment_and_count.assert_not_awaited()


async def test_an_unconfigured_quota_never_rejects_and_never_reads_the_repo() -> None:
    app, runtime, db = _app(next_count=QUOTA + 100, quota=None)
    response = await _post(app, ANON_HEADERS)
    assert response.status_code == 200
    assert runtime.handle.await_count == 1
    db.anon_quota.increment_and_count.assert_not_awaited()


async def test_a_malformed_body_is_rejected_before_quota_consumption() -> None:
    """Malformed input cannot consume anonymous message allowance."""
    app, runtime, db = _app(next_count=1)
    async with async_client(app) as client:
        response = await client.post(
            "/v1/chat", json={"messages": "not-a-list"}, headers=ANON_HEADERS
        )
    assert response.status_code == 422
    db.anon_quota.increment_and_count.assert_not_awaited()
    assert runtime.handle.await_count == 0
