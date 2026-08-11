"""GetSessionHistory response_data envelope parsing (SESSION-1).

The persistence envelope may arrive as a Mapping, a JSON string, or
garbage; the boundary must degrade gracefully (null) and never crash the
transcript page.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

from animichi.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

_AUTH_HEADERS = {"X-User-Id": "user-1", "X-User-Type": "authenticated"}


def _with_envelope(response_data: object) -> dict[str, object]:
    return {
        "role": "assistant",
        "content": "x",
        "response_data": response_data,
        "created_at": "2026-08-01T10:00:00Z",
    }


async def _page(response_data: object) -> object:
    db = build_stub_db()
    db.session.get_conversation = AsyncMock(
        return_value={"user_id": "user-1", "session_id": "s-1"}
    )
    db.messages.get_messages = AsyncMock(return_value=[_with_envelope(response_data)])
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.get("/v1/conversations/s-1/messages", headers=_AUTH_HEADERS)
    return resp.json()["messages"][0]["response_data"]


async def test_json_string_response_data_is_parsed_as_the_envelope() -> None:
    parsed = await _page('{"intent": "search_bangumi", "success": true}')
    assert parsed == {"intent": "search_bangumi", "success": True}


async def test_invalid_json_response_data_degrades_to_null() -> None:
    assert await _page("not-json") is None


async def test_non_mapping_response_data_degrades_to_null() -> None:
    assert await _page(42) is None


async def test_non_string_envelope_fields_degrade_to_none() -> None:
    assert await _page({"intent": 7, "success": "yes"}) == {
        "intent": None,
        "success": None,
    }
