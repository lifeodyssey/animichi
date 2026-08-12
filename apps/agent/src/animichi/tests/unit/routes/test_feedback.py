"""Feedback route behavior tests against the SubmitFeedback seam (AGENT-3).

The route is a thin publisher over the SubmitFeedback use case and the
generated boundary; these tests pin the public wire behavior: owned and
absent-Session success, the forbidden/missing collapse (identical 403 bodies),
validation (422 invalid_request, 400 invalid_json), and the stable persistence
error (500 internal_error).
"""

from __future__ import annotations

from unittest.mock import AsyncMock

from animichi.tests.unit.conftest_fastapi import (
    async_client,
    build_app,
    build_stub_db,
)

_AUTH_HEADERS = {"X-User-Id": "user-1", "X-User-Type": "authenticated"}


def _feedback_payload(
    *,
    session_id: str | None = None,
    query_text: str = "Great app!",
    rating: str = "good",
) -> dict[str, object]:
    payload: dict[str, object] = {"query_text": query_text, "rating": rating}
    if session_id is not None:
        payload["session_id"] = session_id
    return payload


async def test_owned_session_returns_200_with_feedback_id() -> None:
    db = build_stub_db()
    db.session.check_session_owner = AsyncMock(return_value=True)
    db.feedback.save_feedback = AsyncMock(return_value="fb-001")
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/feedback",
            json=_feedback_payload(session_id="sess-123"),
            headers=_AUTH_HEADERS,
        )
    assert resp.status_code == 200
    assert resp.json() == {"feedback_id": "fb-001"}
    db.session.check_session_owner.assert_awaited_once_with("sess-123", "user-1")


async def test_session_feedback_without_identity_returns_401() -> None:
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/feedback",
            json=_feedback_payload(session_id="sess-123"),
        )
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "authentication_error"


async def test_non_owned_session_returns_403_forbidden() -> None:
    db = build_stub_db()
    db.session.check_session_owner = AsyncMock(return_value=False)
    db.feedback.save_feedback = AsyncMock(return_value="fb-001")
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/feedback",
            json=_feedback_payload(session_id="sess-foreign"),
            headers=_AUTH_HEADERS,
        )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"
    db.feedback.save_feedback.assert_not_awaited()


async def test_missing_session_collapses_to_identical_forbidden_body() -> None:
    db = build_stub_db()
    db.session.load = AsyncMock(return_value=None)
    db.session.check_session_owner = AsyncMock(return_value=False)
    db.feedback.save_feedback = AsyncMock(return_value="fb-001")
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        missing = await client.post(
            "/v1/feedback",
            json=_feedback_payload(session_id="sess-missing"),
            headers=_AUTH_HEADERS,
        )
        foreign = await client.post(
            "/v1/feedback",
            json=_feedback_payload(session_id="sess-foreign"),
            headers=_AUTH_HEADERS,
        )
    assert missing.status_code == 403
    assert missing.json() == foreign.json()


async def test_absent_session_saves_without_consulting_ownership() -> None:
    db = build_stub_db()
    db.feedback.save_feedback = AsyncMock(return_value="fb-002")
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/feedback",
            json=_feedback_payload(),
        )
    assert resp.status_code == 200
    assert resp.json() == {"feedback_id": "fb-002"}
    db.session.check_session_owner.assert_not_called()


async def test_blank_query_text_returns_422_invalid_request() -> None:
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/feedback",
            json=_feedback_payload(query_text="   "),
        )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "invalid_request"


async def test_invalid_rating_returns_422_invalid_request() -> None:
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/feedback",
            json=_feedback_payload(rating="great"),
        )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "invalid_request"


async def test_malformed_json_returns_400_invalid_json() -> None:
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/feedback",
            content=b"{not json",
            headers={"Content-Type": "application/json"},
        )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_json"


async def test_persistence_failure_returns_500_internal_error() -> None:
    db = build_stub_db()
    db.session.check_session_owner = AsyncMock(return_value=True)
    db.feedback.save_feedback = AsyncMock(side_effect=RuntimeError("no row"))
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.post(
            "/v1/feedback",
            json=_feedback_payload(session_id="sess-123"),
            headers=_AUTH_HEADERS,
        )
    assert resp.status_code == 500
    assert resp.json()["error"]["code"] == "internal_error"
