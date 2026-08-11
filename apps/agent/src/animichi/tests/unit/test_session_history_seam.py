"""GetSessionHistory seam tests: ordering and ownership collapse (SESSION-1).

The Agent-owned boundary must always return the transcript ordered by
``created_at`` ascending, and missing/forbidden conversations must collapse to
the same 404 so ownership is not observable.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

from animichi.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

_AUTH_HEADERS = {"X-User-Id": "user-1", "X-User-Type": "authenticated"}


def _message(created_at: str, *, role: str = "user", content: str = "x"):
    return {
        "role": role,
        "content": content,
        "response_data": None,
        "created_at": created_at,
    }


def _assistant(created_at: str):
    return {
        "role": "assistant",
        "content": "ルートを作成しました。",
        "response_data": {"intent": "search_bangumi", "success": True},
        "created_at": created_at,
    }


async def test_ordered_history_passes_through_the_agent_seam() -> None:
    db = build_stub_db()
    db.session.get_conversation = AsyncMock(
        return_value={"user_id": "user-1", "session_id": "s-1"}
    )
    db.messages.get_messages = AsyncMock(
        return_value=[
            _assistant("2026-08-01T12:00:00Z"),
            _message("2026-08-01T10:00:00Z", content="first"),
            _message("2026-08-01T11:00:00Z", content="second"),
        ]
    )
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get("/v1/conversations/s-1/messages", headers=_AUTH_HEADERS)

    assert resp.status_code == 200
    body = resp.json()
    assert [row["content"] for row in body["messages"]] == [
        "first",
        "second",
        "ルートを作成しました。",
    ]
    assert body["revision"] == 0
    assert body["next_offset"] is None


async def test_ordered_history_enforces_created_at_sorting_in_the_use_case() -> None:
    db = build_stub_db()
    db.session.get_conversation = AsyncMock(
        return_value={"user_id": "user-1", "session_id": "s-1"}
    )
    db.messages.get_messages = AsyncMock(
        return_value=[
            _message("2026-08-01T12:00:00Z", content="newest"),
            _message("2026-08-01T09:00:00Z", content="oldest"),
            _message("2026-08-01T10:00:00Z", content="middle"),
        ]
    )
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get("/v1/conversations/s-1/messages", headers=_AUTH_HEADERS)

    assert resp.status_code == 200
    assert [row["content"] for row in resp.json()["messages"]] == [
        "oldest",
        "middle",
        "newest",
    ]


async def test_empty_conversation_returns_empty_page() -> None:
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.get(
            "/v1/conversations/s-empty/messages", headers=_AUTH_HEADERS
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["messages"] == []
    assert body["revision"] == 0
    assert body["next_offset"] is None


async def test_missing_conversation_collapses_to_404() -> None:
    db = build_stub_db()
    db.session.get_conversation = AsyncMock(return_value=None)
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get(
            "/v1/conversations/no-such-id/messages", headers=_AUTH_HEADERS
        )

    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"
    db.messages.get_messages.assert_not_awaited()
    db.turn_reservation.current_revision.assert_not_awaited()


async def test_forbidden_conversation_collapses_to_same_404() -> None:
    db = build_stub_db()
    db.session.get_conversation = AsyncMock(
        return_value={"user_id": "someone-else", "session_id": "s-1"}
    )
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get("/v1/conversations/s-1/messages", headers=_AUTH_HEADERS)

    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"
    db.messages.get_messages.assert_not_awaited()
