"""Regression tests for the shared runtime input ceiling."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from agent.config.settings import Settings
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.schemas import (
    JsonObject,
    PublicAPIResponse,
    as_json_object,
)
from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db


def _runtime(settings: Settings) -> RuntimeAPI:
    return RuntimeAPI(
        build_stub_db(),
        session_store=InMemorySessionStore(),
        catalog=MagicMock(),
        settings=settings,
        model_http_client=MagicMock(),
    )


async def _post(
    runtime: RuntimeAPI, settings: Settings, path: str, payload: object
) -> httpx.Response:
    app, _ = build_app(runtime_api=runtime, settings=settings)
    async with async_client(app) as client:
        return await asyncio.wait_for(client.post(path, json=payload), timeout=1)


def _done_payload(response: httpx.Response) -> JsonObject:
    encoded = response.text.split("event: done\ndata: ", 1)[1].split("\n\n", 1)[0]
    return as_json_object(json.loads(encoded))


def _assert_safe_error(response: httpx.Response, expected: str) -> None:
    assert response.status_code == 400
    assert response.json()["message"] == expected
    assert response.json()["errors"] == [
        {"code": "invalid_input", "message": expected, "details": {}}
    ]
    assert "MESSAGE_MAX_CHARS" not in response.text
    assert "4000" not in response.text


@pytest.mark.parametrize(
    ("locale", "expected"),
    [
        ("ja", "メッセージが長すぎます。短くしてもう一度お試しください。"),
        ("zh", "消息太长了，请缩短后重试。"),
        ("en", "Your message is too long. Please shorten it and try again."),
    ],
)
async def test_runtime_rejects_over_limit_before_agent_with_safe_copy(
    locale: str, expected: str
) -> None:
    settings = Settings(message_max_chars=4000)
    with patch(
        "agent.interfaces.public_api.run_animichi_agent", new_callable=AsyncMock
    ) as runner:
        response = await _post(
            _runtime(settings),
            settings,
            "/v1/runtime",
            {"text": "x" * 4001, "locale": locale},
        )
    _assert_safe_error(response, expected)
    runner.assert_not_awaited()


async def test_runtime_stream_rejects_before_agent_and_terminates() -> None:
    settings = Settings(message_max_chars=4)
    with patch(
        "agent.interfaces.public_api.run_animichi_agent", new_callable=AsyncMock
    ) as runner:
        response = await _post(
            _runtime(settings),
            settings,
            "/v1/runtime/stream",
            {"text": "12345"},
        )
    payload = _done_payload(response)
    assert response.status_code == 200
    assert payload["success"] is False
    assert payload["status"] == "invalid_request"
    assert response.text.endswith("\n\n")
    runner.assert_not_awaited()


@pytest.mark.parametrize("path", ["/v1/runtime", "/v1/runtime/stream"])
async def test_runtime_routes_reject_non_text_before_runtime(path: str) -> None:
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(success=True, status="ok", intent="qa")
    )
    runtime._db = build_stub_db()
    response = await _post(runtime, Settings(), path, {"text": ["not", "text"]})
    assert response.status_code == 422
    runtime.handle.assert_not_awaited()
