"""GET /v1/conversations happy-path coverage (SESSION-3 #961).

The list route's authenticated path (final SessionRepository.list_sessions)
is the sole remaining conversations surface after the cutover.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

from animichi.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

_AUTH_HEADERS = {"X-User-Id": "user-1", "X-User-Type": "authenticated"}


async def test_list_conversations_returns_the_session_list() -> None:
    db = build_stub_db()
    db.session.list_sessions = AsyncMock(return_value=[])
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get("/v1/conversations", headers=_AUTH_HEADERS)

    assert resp.status_code == 200
    assert resp.json() == []
    db.session.list_sessions.assert_awaited_once_with("user-1")
