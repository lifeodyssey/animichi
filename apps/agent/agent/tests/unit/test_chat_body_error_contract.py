"""Snapshots for the public chat request-body error contract."""

from __future__ import annotations

import json

import pytest

from agent.tests.unit.conftest_fastapi import async_client, build_app


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        pytest.param(
            b'{"messages":[}',
            b'{"error":{"code":"http_error","message":"invalid JSON body"}}',
            id="malicious-json",
        ),
        pytest.param(
            b"{}",
            b'{"error":{"code":"http_error","message":"messages must be a list"}}',
            id="missing-messages",
        ),
        pytest.param(
            b'{"messages":[],"selected_point_ids":"p1"}',
            b'{"error":{"code":"http_error","message":"selected_point_ids must be a string list"}}',
            id="wrong-field-type",
        ),
    ],
)
async def test_chat_body_4xx_response_snapshot(payload: bytes, expected: bytes) -> None:
    app, _ = build_app()
    headers = {"X-User-Id": "user-1", "Content-Type": "application/json"}
    async with async_client(app) as client:
        response = await client.post("/v1/chat", content=payload, headers=headers)
    assert response.status_code == 422
    assert response.json() == json.loads(expected)
    assert response.content == expected
