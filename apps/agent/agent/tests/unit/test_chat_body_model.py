"""Compatibility coverage for declarative chat body validation."""

from __future__ import annotations

import pytest

from agent.interfaces.routes.chat_body import ChatBody
from agent.tests.unit.conftest_fastapi import async_client, build_app


def make_chat_body(*messages: object, **fields: object) -> dict[str, object]:
    return {"messages": list(messages), **fields}


def make_history_body() -> dict[str, object]:
    return make_chat_body(
        {"role": "user", "parts": [{"type": "image"}]},
        {"role": "assistant", "parts": [{"type": "tool-result"}]},
        7,
        {"role": "user", "parts": [{"type": "text", "text": "latest", "extra": True}]},
        client_only="ignored",
    )


_DEFAULT_OPTIONAL_FIELDS = {
    "selected_point_ids": None,
    "selected_candidate_ids": None,
    "clarification_id": None,
    "origin": None,
    "origin_lat": None,
    "origin_lng": None,
}


def _error_wire(message: str, code: str = "http_error") -> bytes:
    return f'{{"error":{{"code":"{code}","message":"{message}"}}}}'.encode()


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        pytest.param(b"", "invalid JSON body", id="empty-body"),
        pytest.param(b"null", "request body must be an object", id="null-body"),
        pytest.param(b"[]", "request body must be an object", id="array-body"),
        pytest.param(b'{"messages":"x"}', "messages must be a list", id="messages"),
        pytest.param(
            b'{"messages":[],"selected_candidate_ids":[1]}',
            "selected_candidate_ids must be a string list",
            id="candidate-ids",
        ),
        pytest.param(
            b'{"messages":[],"clarification_id":true}',
            "clarification_id must be an integer",
            id="clarification-id",
        ),
        pytest.param(
            b'{"messages":[],"origin":1}',
            "origin must be a string",
            id="origin",
        ),
        pytest.param(
            b'{"messages":[],"origin_lat":true}',
            "origin_lat must be a number",
            id="origin-lat",
        ),
        pytest.param(
            b'{"messages":[],"origin_lng":"1"}',
            "origin_lng must be a number",
            id="origin-lng",
        ),
        pytest.param(
            b'{"messages":[{"role":"user","parts":"x"}]}',
            "テキストメッセージを入力してください。",
            id="user-parts",
        ),
    ],
)
async def test_chat_body_validation_preserves_error_contract(
    payload: bytes, message: str
) -> None:
    app, _ = build_app()
    headers = {"X-User-Id": "user-1", "Content-Type": "application/json"}
    async with async_client(app) as client:
        response = await client.post("/v1/chat", content=payload, headers=headers)
    assert response.status_code == 422
    assert response.content == _error_wire(message)


async def test_auth_rejection_precedes_invalid_json() -> None:
    app, _ = build_app()
    headers = {"Content-Type": "application/json"}
    async with async_client(app) as client:
        response = await client.post("/v1/chat", content=b"{", headers=headers)
    assert response.status_code == 400
    assert response.content == _error_wire(
        "X-User-Id header required.", code="invalid_request"
    )


def test_chat_body_ignores_extra_and_unread_history_messages() -> None:
    body = ChatBody.model_validate(make_history_body())
    assert body.last_user_text(100) == "latest"
    assert body.model_dump(exclude={"messages"}) == _DEFAULT_OPTIONAL_FIELDS


def test_chat_body_accepts_integer_coordinates() -> None:
    body = ChatBody.model_validate(make_chat_body(origin_lat=35, origin_lng=139))
    assert body.origin_lat == 35.0
    assert body.origin_lng == 139.0
