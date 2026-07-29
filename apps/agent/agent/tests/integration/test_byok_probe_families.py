"""BYOK probe coverage for the anthropic/gemini families (#284 Task 5,
#479 P3 review: only `openai-compatible` had probe coverage; the other two
branches of `build_byok_model` were untested end-to-end through the probe
route).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from agent.tests.integration._byok_probe_shared import (
    HUMAN_HEADERS,
    FixedResponseTransport,
    app,
    byok_model_with_transport,
    post_probe,
)

pytestmark = pytest.mark.integration

_ANTHROPIC_HEADERS = {"X-BYOK-Provider": "anthropic", "X-BYOK-Key": "sk-ant-fake"}
_GEMINI_HEADERS = {"X-BYOK-Provider": "gemini", "X-BYOK-Key": "gemini-fake-key"}

_ANTHROPIC_OK = (
    b'{"id":"msg_1","type":"message","role":"assistant",'
    b'"content":[{"type":"text","text":"OK"}],"model":"claude-3",'
    b'"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}'
)
_ANTHROPIC_401 = (
    b'{"type":"error","error":{"type":"authentication_error","message":"invalid key"}}'
)

_GEMINI_OK = (
    b'{"candidates":[{"content":{"parts":[{"text":"OK"}],"role":"model"},'
    b'"finishReason":"STOP","index":0}],'
    b'"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}'
)
_GEMINI_401 = (
    b'{"error":{"code":401,"message":"API key invalid","status":"UNAUTHENTICATED"}}'
)


async def test_anthropic_probe_success_reports_vision_and_reachable() -> None:
    transport = FixedResponseTransport(200, _ANTHROPIC_OK)
    byok_model = await byok_model_with_transport(
        transport, provider="anthropic", model="claude-3", base_url=None
    )
    built = app()
    with patch(
        "agent.interfaces.routes.byok.build_byok_model",
        AsyncMock(return_value=byok_model),
    ):
        response = await post_probe(built, HUMAN_HEADERS | _ANTHROPIC_HEADERS)
    assert response.status_code == 200
    assert response.json() == {"vision": True, "reachable": True, "error_code": None}
    assert len(transport.requests) == 1


async def test_anthropic_probe_401_reports_credential_rejected() -> None:
    transport = FixedResponseTransport(401, _ANTHROPIC_401)
    byok_model = await byok_model_with_transport(
        transport, provider="anthropic", model="claude-3", base_url=None
    )
    built = app()
    with patch(
        "agent.interfaces.routes.byok.build_byok_model",
        AsyncMock(return_value=byok_model),
    ):
        response = await post_probe(built, HUMAN_HEADERS | _ANTHROPIC_HEADERS)
    assert response.json()["error_code"] == "byok_credential_rejected"


async def test_gemini_probe_success_reports_vision_and_reachable() -> None:
    transport = FixedResponseTransport(200, _GEMINI_OK)
    byok_model = await byok_model_with_transport(
        transport, provider="gemini", model="gemini-test", base_url=None
    )
    built = app()
    with patch(
        "agent.interfaces.routes.byok.build_byok_model",
        AsyncMock(return_value=byok_model),
    ):
        response = await post_probe(built, HUMAN_HEADERS | _GEMINI_HEADERS)
    assert response.status_code == 200
    assert response.json() == {"vision": True, "reachable": True, "error_code": None}
    assert len(transport.requests) == 1


async def test_gemini_probe_401_reports_credential_rejected() -> None:
    transport = FixedResponseTransport(401, _GEMINI_401)
    byok_model = await byok_model_with_transport(
        transport, provider="gemini", model="gemini-test", base_url=None
    )
    built = app()
    with patch(
        "agent.interfaces.routes.byok.build_byok_model",
        AsyncMock(return_value=byok_model),
    ):
        response = await post_probe(built, HUMAN_HEADERS | _GEMINI_HEADERS)
    assert response.json()["error_code"] == "byok_credential_rejected"
