"""Unit tests for POST /v1/sessions/adopt (SESSION-2 #960).

Covers the endpoint contract: auth predicate positive/negative, response
shape, trusted-input validation of X-Anon-Id, and the rejection of any
client-supplied Session id.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

from animichi.application.adopt_sessions import AdoptionResult
from animichi.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

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


async def test_happy_path_adopts_and_reports_count() -> None:
    db = build_stub_db()
    db.session.adopt_ownership = AsyncMock(
        return_value=AdoptionResult(adopted_count=2, revisions_bumped=2)
    )
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post("/v1/sessions/adopt", headers=_headers())
    assert resp.status_code == 200
    assert resp.json() == {
        "adopted": 2,
        "noop_class": "adopted",
        "revisions_bumped": 2,
    }
    db.session.adopt_ownership.assert_awaited_once_with(VALID_ANON_ID, "user-1")


async def test_no_owned_conversations_reports_replay_no_op() -> None:
    db = build_stub_db()
    db.session.adopt_ownership = AsyncMock(
        return_value=AdoptionResult(adopted_count=0, revisions_bumped=0)
    )
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post("/v1/sessions/adopt", headers=_headers())
    assert resp.status_code == 200
    assert resp.json()["noop_class"] == "no_rows"
    assert resp.json()["adopted"] == 0


async def test_missing_x_anon_id_is_cross_device_no_op_and_mutates_nothing() -> None:
    db = build_stub_db()
    db.session.adopt_ownership = AsyncMock(
        return_value=AdoptionResult(adopted_count=1, revisions_bumped=1)
    )
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post("/v1/sessions/adopt", headers=_headers(anon_id=None))
    assert resp.status_code == 200
    assert resp.json()["noop_class"] == "no_anonymous_identity"
    assert resp.json()["adopted"] == 0
    db.session.adopt_ownership.assert_not_called()


async def test_anonymous_user_type_is_rejected_403_and_mutates_nothing() -> None:
    db = build_stub_db()
    db.session.adopt_ownership = AsyncMock(
        return_value=AdoptionResult(adopted_count=1, revisions_bumped=1)
    )
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/sessions/adopt",
            headers=_headers(user_id=VALID_ANON_ID, user_type="anonymous"),
        )
    assert resp.status_code == 403
    db.session.adopt_ownership.assert_not_called()


async def test_anon_prefixed_user_id_is_rejected_even_with_human_type() -> None:
    db = build_stub_db()
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/sessions/adopt",
            headers=_headers(user_id=VALID_ANON_ID, user_type="human"),
        )
    assert resp.status_code == 403
    db.session.adopt_ownership.assert_not_called()


async def test_real_production_literal_human_is_accepted() -> None:
    db = build_stub_db()
    db.session.adopt_ownership = AsyncMock(
        return_value=AdoptionResult(adopted_count=0, revisions_bumped=0)
    )
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/sessions/adopt", headers=_headers(user_type="human")
        )
    assert resp.status_code == 200


async def test_malformed_x_anon_id_is_treated_as_missing() -> None:
    db = build_stub_db()
    db.session.adopt_ownership = AsyncMock(
        return_value=AdoptionResult(adopted_count=1, revisions_bumped=1)
    )
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/sessions/adopt", headers=_headers(anon_id="not-an-anon-id")
        )
    assert resp.status_code == 200
    assert resp.json()["noop_class"] == "no_anonymous_identity"
    db.session.adopt_ownership.assert_not_called()


async def test_response_shape_is_exactly_adopted_and_noop_class() -> None:
    db = build_stub_db()
    db.session.adopt_ownership = AsyncMock(
        return_value=AdoptionResult(adopted_count=1, revisions_bumped=1)
    )
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post("/v1/sessions/adopt", headers=_headers())
    assert set(resp.json().keys()) == {"adopted", "noop_class", "revisions_bumped"}
    assert isinstance(resp.json()["adopted"], int)
    assert isinstance(resp.json()["noop_class"], str)
    assert isinstance(resp.json()["revisions_bumped"], int)


async def test_client_session_id_in_query_is_rejected_400() -> None:
    db = build_stub_db()
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/sessions/adopt?session_id=client-supplied",
            headers=_headers(),
        )
    assert resp.status_code == 400
    db.session.adopt_ownership.assert_not_called()


async def test_client_session_id_in_body_is_rejected_400() -> None:
    db = build_stub_db()
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/sessions/adopt",
            json={"session_id": "client-supplied"},
            headers=_headers(),
        )
    assert resp.status_code == 400
    db.session.adopt_ownership.assert_not_called()


async def test_client_session_id_in_header_is_rejected_400() -> None:
    db = build_stub_db()
    app, _ = build_app(db=db)
    headers = _headers()
    headers["X-Session-Id"] = "client-supplied"
    async with async_client(app) as client:
        resp = await client.post("/v1/sessions/adopt", headers=headers)
    assert resp.status_code == 400
    db.session.adopt_ownership.assert_not_called()


async def test_oversized_body_is_rejected_413_and_mutates_nothing() -> None:
    db = build_stub_db()
    db.session.adopt_ownership = AsyncMock(
        return_value=AdoptionResult(adopted_count=1, revisions_bumped=1)
    )
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/sessions/adopt",
            headers=_headers(),
            content=b"x" * 2048,
        )
    assert resp.status_code == 413
    db.session.adopt_ownership.assert_not_called()
