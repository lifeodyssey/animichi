"""`POST /v1/byok/probe` (#284 Task 5).

Every case swaps in a fake transport post-construction (the same pattern
`test_byok_model_construction.py` and `test_byok_chat_routing.py` already
use) so no real network call is ever made.
"""

from __future__ import annotations

import socket
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import FastAPI

from agent.agents.byok_models import ByokModel, build_byok_model
from agent.tests.unit.conftest_fastapi import async_client, build_app

pytestmark = pytest.mark.integration

_STUB_PUBLIC_IP = "8.8.8.8"


_real_getaddrinfo = socket.getaddrinfo


@pytest.fixture(autouse=True)
def _stub_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    """Hermetic DNS (mirrors `test_byok_model_construction.py`): the
    `openai-compatible` family's pre-flight `validate_base_url` call
    resolves the host for real unless patched.

    Only the fixture domain is faked — an IP-literal `base_url` (the SSRF
    test) must still resolve through the real, fast, non-network numeric
    path so the guard's own rejection is exercised, not this fixture's.
    """

    def _fake_getaddrinfo(
        host: str, port: int, *args: object, **kwargs: object
    ) -> list[tuple[object, ...]]:
        if host == "byok.example.test":
            return [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", (_STUB_PUBLIC_IP, port))
            ]
        return _real_getaddrinfo(host, port, *args, **kwargs)

    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo)


HUMAN_HEADERS = {"X-User-Id": "user-1", "X-User-Type": "human"}
ANON_HEADERS = {
    "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
    "X-User-Type": "anonymous",
}
BYOK_HEADERS = {
    "X-BYOK-Provider": "openai-compatible",
    "X-BYOK-Key": "sk-fake-secret-value",
    "X-BYOK-Model": "byok-test-model",
    "X-BYOK-Base-Url": "https://byok.example.test/v1",
}

_OK_COMPLETION = b"""{
  "id": "chatcmpl-probe",
  "choices": [{
    "finish_reason": "stop",
    "index": 0,
    "message": {"content": "OK", "role": "assistant"}
  }],
  "created": 0,
  "model": "byok-test-model",
  "object": "chat.completion"
}"""


class _FixedResponseTransport(httpx.AsyncBaseTransport):
    def __init__(self, status_code: int, content: bytes) -> None:
        self.status_code = status_code
        self.content = content
        self.requests: list[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(
            self.status_code,
            content=self.content,
            headers={"Content-Type": "application/json"},
            request=request,
        )


def _error_body(message: str) -> bytes:
    return f'{{"error": {{"message": "{message}", "type": "error"}}}}'.encode()


async def _byok_model_with_transport(transport: httpx.AsyncBaseTransport) -> ByokModel:
    """Build a real `ByokModel` (real client lifecycle), transport swapped
    post-construction — never touches the network."""
    from agent.agents.byok_models import ByokCredential

    model = await build_byok_model(
        ByokCredential(
            provider="openai-compatible",
            key="sk-fake-secret-value",
            model="byok-test-model",
            base_url="https://byok.example.test/v1",
        )
    )
    model.client._transport = transport
    return model


def _app() -> FastAPI:
    app, _ = build_app()
    return app


async def _post(app: FastAPI, headers: dict[str, str]) -> httpx.Response:
    async with async_client(app) as client:
        return await client.post("/v1/byok/probe", headers=headers)


def _patched_build(byok_model: ByokModel) -> object:
    return patch(
        "agent.interfaces.routes.byok.build_byok_model",
        AsyncMock(return_value=byok_model),
    )


async def test_successful_probe_reports_vision_and_reachable_with_one_upstream_call() -> (
    None
):
    transport = _FixedResponseTransport(200, _OK_COMPLETION)
    byok_model = await _byok_model_with_transport(transport)
    app = _app()
    with _patched_build(byok_model):
        response = await _post(app, HUMAN_HEADERS | BYOK_HEADERS)
    assert response.status_code == 200
    assert response.json() == {"vision": True, "reachable": True, "error_code": None}
    assert len(transport.requests) == 1


async def test_no_byok_headers_is_invalid_request_with_no_upstream_call() -> None:
    app = _app()
    with patch(
        "agent.interfaces.routes.byok.build_byok_model",
        AsyncMock(side_effect=AssertionError("must not be called")),
    ):
        response = await _post(app, HUMAN_HEADERS)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


async def test_provider_rejecting_the_image_reports_vision_false_reachable_true() -> (
    None
):
    transport = _FixedResponseTransport(400, _error_body("image content not supported"))
    byok_model = await _byok_model_with_transport(transport)
    app = _app()
    with _patched_build(byok_model):
        response = await _post(app, HUMAN_HEADERS | BYOK_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["vision"] is False
    assert body["reachable"] is True
    assert body["error_code"] is None


async def test_provider_401_reports_unreachable_credential_rejected_with_no_key_echo() -> (
    None
):
    transport = _FixedResponseTransport(
        401, _error_body("invalid api key sk-fake-secret-value")
    )
    byok_model = await _byok_model_with_transport(transport)
    app = _app()
    with _patched_build(byok_model):
        response = await _post(app, HUMAN_HEADERS | BYOK_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "vision": False,
        "reachable": False,
        "error_code": "byok_credential_rejected",
    }
    assert "sk-fake-secret-value" not in response.text


async def test_provider_403_also_reports_credential_rejected() -> None:
    """403 is the other auth-distinguishable outcome (401/403), never
    collapsed into `provider_unreachable` alongside connectivity failures."""
    transport = _FixedResponseTransport(403, _error_body("forbidden"))
    byok_model = await _byok_model_with_transport(transport)
    app = _app()
    with _patched_build(byok_model):
        response = await _post(app, HUMAN_HEADERS | BYOK_HEADERS)
    assert response.status_code == 200
    assert response.json()["error_code"] == "byok_credential_rejected"


async def test_ssrf_blocked_base_url_is_rejected_with_no_socket_opened() -> None:
    app = _app()
    headers = HUMAN_HEADERS | (
        BYOK_HEADERS | {"X-BYOK-Base-Url": "https://127.0.0.1/v1"}
    )
    with patch(
        "agent.interfaces.routes.byok.build_byok_model",
        AsyncMock(side_effect=AssertionError("must not open a socket")),
    ):
        response = await _post(app, headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "egress_blocked"


async def test_anonymous_caller_with_byok_headers_is_rejected() -> None:
    app = _app()
    response = await _post(app, ANON_HEADERS | BYOK_HEADERS)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "byok_requires_login"
