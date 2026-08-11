"""GetSessionHistory pagination + boundary tests (SESSION-1 #959).

Revision, bounded pagination (``limit``/``offset``/``next_offset``), route
bounds, and parsing through the generated boundary model.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

from animichi.interfaces.boundary.agent_models import (
    GetSessionHistoryResponse,
    GetSessionHistoryResponseMessagesResponse_data,
)
from animichi.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

_AUTH_HEADERS = {"X-User-Id": "user-1", "X-User-Type": "authenticated"}


def _message(created_at: str, *, role: str = "user", content: str = "x"):
    return {
        "role": role,
        "content": content,
        "response_data": None,
        "created_at": created_at,
    }


def _assistant(
    created_at: str,
    *,
    intent: str | None = "search_bangumi",
    success: bool | None = True,
):
    return {
        "role": "assistant",
        "content": "ルートを作成しました。",
        "response_data": {"intent": intent, "success": success},
        "created_at": created_at,
    }


async def test_revision_echoes_the_session_revision() -> None:
    db = build_stub_db()
    db.session.get_conversation = AsyncMock(
        return_value={"user_id": "user-1", "session_id": "s-1"}
    )
    db.turn_reservation.current_revision = AsyncMock(return_value=7)
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get("/v1/conversations/s-1/messages", headers=_AUTH_HEADERS)

    assert resp.status_code == 200
    assert resp.json()["revision"] == 7
    db.turn_reservation.current_revision.assert_awaited_once_with("s-1")


async def test_pagination_returns_next_offset_then_final_page() -> None:
    db = build_stub_db()
    db.session.get_conversation = AsyncMock(
        return_value={"user_id": "user-1", "session_id": "s-1"}
    )
    rows = [
        _message("2026-08-01T09:00:00Z", content="m1"),
        _message("2026-08-01T10:00:00Z", content="m2"),
        _message("2026-08-01T11:00:00Z", content="m3"),
    ]

    async def page_rows(session_id: str, *, limit: int, offset: int):
        assert session_id == "s-1"
        return rows[offset : offset + limit]

    db.messages.get_messages = AsyncMock(side_effect=page_rows)
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        first = await client.get(
            "/v1/conversations/s-1/messages?limit=2", headers=_AUTH_HEADERS
        )
        second = await client.get(
            "/v1/conversations/s-1/messages?limit=2&offset=2", headers=_AUTH_HEADERS
        )

    assert first.status_code == 200
    assert [row["content"] for row in first.json()["messages"]] == ["m1", "m2"]
    assert first.json()["next_offset"] == 2
    assert second.status_code == 200
    assert [row["content"] for row in second.json()["messages"]] == ["m3"]
    assert second.json()["next_offset"] is None


async def test_pagination_bounds_are_enforced_by_the_route() -> None:
    app, _ = build_app()
    async with async_client(app) as client:
        too_small = await client.get(
            "/v1/conversations/s-1/messages?limit=0", headers=_AUTH_HEADERS
        )
        too_large = await client.get(
            "/v1/conversations/s-1/messages?limit=101", headers=_AUTH_HEADERS
        )
        negative_offset = await client.get(
            "/v1/conversations/s-1/messages?offset=-1", headers=_AUTH_HEADERS
        )
        huge_offset = await client.get(
            "/v1/conversations/s-1/messages?offset=1001", headers=_AUTH_HEADERS
        )

    assert too_small.status_code == 422
    assert too_large.status_code == 422
    assert negative_offset.status_code == 422
    assert huge_offset.status_code == 422


async def test_next_offset_is_capped_at_the_route_ceiling() -> None:
    db = build_stub_db()
    db.session.get_conversation = AsyncMock(
        return_value={"user_id": "user-1", "session_id": "s-1"}
    )
    db.messages.get_messages = AsyncMock(
        return_value=[_message(f"2026-08-01T{i:02d}:00:00Z") for i in range(11)]
    )
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get(
            "/v1/conversations/s-1/messages?limit=10&offset=995",
            headers=_AUTH_HEADERS,
        )

    assert resp.status_code == 200
    assert resp.json()["next_offset"] is None
    db.messages.get_messages.assert_awaited_once_with("s-1", limit=11, offset=995)


async def test_response_parses_as_the_generated_boundary() -> None:
    db = build_stub_db()
    db.session.get_conversation = AsyncMock(
        return_value={"user_id": "user-1", "session_id": "s-1"}
    )
    db.messages.get_messages = AsyncMock(
        return_value=[
            _assistant("2026-08-01T12:00:00Z", intent="plan_route", success=True)
        ]
    )
    db.turn_reservation.current_revision = AsyncMock(return_value=3)
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get("/v1/conversations/s-1/messages", headers=_AUTH_HEADERS)

    parsed = GetSessionHistoryResponse.model_validate(resp.json())
    assert parsed.revision == 3
    assert parsed.next_offset is None
    message = parsed.messages[0]
    assert message.role == "assistant"
    assert message.response_data == GetSessionHistoryResponseMessagesResponse_data(
        intent="plan_route", success=True
    )
