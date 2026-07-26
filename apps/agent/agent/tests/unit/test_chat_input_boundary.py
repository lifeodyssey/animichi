"""Unit tests for chat message type and length validation."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from agent.config.settings import Settings
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.schemas import PublicAPIResponse
from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db


def _body(text: object) -> object:
    return {"messages": [{"role": "user", "parts": [{"type": "text", "text": text}]}]}


def _runtime() -> MagicMock:
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(
            success=True, status="ok", intent="qa", message="ok"
        )
    )
    runtime._db = build_stub_db()
    return runtime


async def _post(
    client: httpx.AsyncClient, body: object, locale: str = "ja"
) -> httpx.Response:
    return await client.post(
        "/v1/chat",
        json=body,
        headers={"X-User-Id": "user-1", "X-Locale": locale},
    )


def _error_message(response: httpx.Response) -> str:
    payload: object = response.json()
    if not isinstance(payload, dict):
        raise AssertionError("expected an error object")
    error = payload.get("error")
    if not isinstance(error, dict):
        raise AssertionError("expected an error payload")
    message = error.get("message")
    if not isinstance(message, str):
        raise AssertionError("expected an error message")
    return message


async def test_message_at_configured_limit_is_accepted() -> None:
    runtime = _runtime()
    app, _ = build_app(runtime_api=runtime, settings=Settings(message_max_chars=4))
    async with async_client(app) as client:
        response = await _post(client, _body("巡礼検索"))
    assert response.status_code == 200
    runtime.handle.assert_awaited_once()


async def test_message_over_limit_is_rejected_before_runtime() -> None:
    runtime = _runtime()
    app, _ = build_app(runtime_api=runtime, settings=Settings(message_max_chars=4))
    async with async_client(app) as client:
        response = await _post(client, _body("巡礼検索!"))
    assert response.status_code == 422
    assert _error_message(response) == (
        "メッセージが長すぎます。短くしてもう一度お試しください。"
    )
    runtime.handle.assert_not_awaited()


async def test_non_text_message_is_rejected_before_runtime() -> None:
    runtime = _runtime()
    app, _ = build_app(runtime_api=runtime)
    body = {"messages": [{"role": "user", "parts": [{"type": "image"}]}]}
    async with async_client(app) as client:
        response = await _post(client, body)
    assert response.status_code == 422
    assert _error_message(response) == "テキストメッセージを入力してください。"
    runtime.handle.assert_not_awaited()


@pytest.mark.parametrize(
    ("locale", "body", "expected"),
    [
        ("ja", _body("xx"), "メッセージが長すぎます。短くしてもう一度お試しください。"),
        ("zh", _body("xx"), "消息太长了，请缩短后重试。"),
        (
            "en",
            _body("xx"),
            "Your message is too long. Please shorten it and try again.",
        ),
        (
            "ja",
            {"messages": [{"role": "user", "parts": [{"type": "image"}]}]},
            "テキストメッセージを入力してください。",
        ),
        (
            "zh",
            {"messages": [{"role": "user", "parts": [{"type": "image"}]}]},
            "请输入文字消息。",
        ),
        (
            "en",
            {"messages": [{"role": "user", "parts": [{"type": "image"}]}]},
            "Please enter a text message.",
        ),
    ],
)
async def test_input_error_copy_is_localized_and_nontechnical(
    locale: str, body: object, expected: str
) -> None:
    app, _ = build_app(runtime_api=_runtime(), settings=Settings(message_max_chars=1))
    async with async_client(app) as client:
        response = await _post(client, body, locale)
    message = _error_message(response)
    assert message == expected
    assert "MESSAGE_MAX_CHARS" not in message
    assert "4000" not in message


def test_message_ceiling_defaults_to_4000(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MESSAGE_MAX_CHARS", raising=False)
    assert Settings(_env_file=None).message_max_chars == 4000


def test_message_ceiling_reads_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MESSAGE_MAX_CHARS", "17")
    assert Settings(_env_file=None).message_max_chars == 17
