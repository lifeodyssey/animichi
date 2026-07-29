"""Unit tests for POST /v1/session/migrate (issue #273 Task 3).

Covers the endpoint contract: auth predicate positive/negative, response
shape, and trusted-input validation of X-Anon-Id.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

VALID_ANON_ID = "anon_" + "a" * 32


def _headers(
    *,
    user_id: str = "user-1",
    user_type: str = "human",
    anon_id: str | None = VALID_ANON_ID,
) -> dict[str, str]:
    headers = {"X-User-Id": user_id, "X-User-Type": user_type}
    if anon_id is not None:
        headers["X-Anon-Id"] = anon_id
    return headers


async def test_happy_path_migrates_and_returns_true() -> None:
    db = build_stub_db()
    db.session.migrate_ownership = AsyncMock(return_value=True)
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post("/v1/session/migrate", headers=_headers())
    assert resp.status_code == 200
    assert resp.json() == {"migrated": True}
    db.session.migrate_ownership.assert_awaited_once_with(VALID_ANON_ID, "user-1")


async def test_no_owned_conversations_returns_false_not_error() -> None:
    db = build_stub_db()
    db.session.migrate_ownership = AsyncMock(return_value=False)
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post("/v1/session/migrate", headers=_headers())
    assert resp.status_code == 200
    assert resp.json() == {"migrated": False}


async def test_missing_x_anon_id_returns_false_and_mutates_nothing() -> None:
    db = build_stub_db()
    db.session.migrate_ownership = AsyncMock(return_value=True)
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post("/v1/session/migrate", headers=_headers(anon_id=None))
    assert resp.status_code == 200
    assert resp.json() == {"migrated": False}
    db.session.migrate_ownership.assert_not_called()


async def test_anonymous_user_type_is_rejected_403_and_mutates_nothing() -> None:
    db = build_stub_db()
    db.session.migrate_ownership = AsyncMock(return_value=True)
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/session/migrate",
            headers=_headers(user_id=VALID_ANON_ID, user_type="anonymous"),
        )
    assert resp.status_code == 403
    db.session.migrate_ownership.assert_not_called()


async def test_anon_prefixed_user_id_is_rejected_even_with_human_type() -> None:
    db = build_stub_db()
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/session/migrate",
            headers=_headers(user_id=VALID_ANON_ID, user_type="human"),
        )
    assert resp.status_code == 403
    db.session.migrate_ownership.assert_not_called()


async def test_real_production_literal_human_is_accepted() -> None:
    db = build_stub_db()
    db.session.migrate_ownership = AsyncMock(return_value=False)
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/session/migrate", headers=_headers(user_type="human")
        )
    assert resp.status_code == 200


async def test_real_production_literal_agent_is_accepted() -> None:
    db = build_stub_db()
    db.session.migrate_ownership = AsyncMock(return_value=False)
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/session/migrate", headers=_headers(user_type="agent")
        )
    assert resp.status_code == 200


async def test_malformed_x_anon_id_is_treated_as_missing() -> None:
    db = build_stub_db()
    db.session.migrate_ownership = AsyncMock(return_value=True)
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/session/migrate", headers=_headers(anon_id="not-an-anon-id")
        )
    assert resp.status_code == 200
    assert resp.json() == {"migrated": False}
    db.session.migrate_ownership.assert_not_called()


async def test_response_shape_is_exactly_migrated_bool() -> None:
    db = build_stub_db()
    db.session.migrate_ownership = AsyncMock(return_value=True)
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post("/v1/session/migrate", headers=_headers())
    assert set(resp.json().keys()) == {"migrated"}
    assert isinstance(resp.json()["migrated"], bool)
