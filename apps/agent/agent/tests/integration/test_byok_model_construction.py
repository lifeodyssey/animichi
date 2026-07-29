"""Integration tests for the three BYOK model families (#284 T3-AC1, T3-AC2).

Every family is verified separately. `openai-compatible` gets a full live
request round-trip (transport swapped post-construction for a recording
double, proving the header actually reaches an outbound call); `anthropic`
and `gemini` are verified by inspecting the constructed SDK client the same
way `test_model_failover.py` already does for the server-default model
(`model.client.api_key`, `model.client.max_retries`) — a lighter but
equally load-bearing assertion of "the user's credential reached the right
place", without depending on either provider's exact wire format.
"""

from __future__ import annotations

import socket

import httpx
import pytest
from pydantic_ai import Agent
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.openai import OpenAIChatModel

from agent.agents.byok_models import ByokCredential, ByokProvider, build_byok_model
from agent.infrastructure.egress_transport import GuardedAsyncTransport

pytestmark = pytest.mark.integration

_STUB_PUBLIC_IP = "8.8.8.8"


@pytest.fixture(autouse=True)
def _stub_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    """Hermetic DNS (P2①): the `openai-compatible` family's pre-flight
    `validate_base_url` call does a real resolution. Mirrors Task 1's own
    pattern (`test_egress_dns_resolution.py`) of patching `socket.getaddrinfo`
    directly — `default_resolve`'s `resolver` parameter is bound at
    function-definition time, so reassigning the `egress_guard` module
    attribute would have no effect on an already-bound default.
    """

    def _fake_getaddrinfo(
        host: str, port: int, *_args: object, **_kwargs: object
    ) -> list[tuple[object, ...]]:
        del host
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (_STUB_PUBLIC_IP, port))]

    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo)


_CHAT_COMPLETION = b"""{
  "id": "chatcmpl-byok",
  "choices": [{
    "finish_reason": "stop",
    "index": 0,
    "message": {"content": "ok", "role": "assistant"}
  }],
  "created": 0,
  "model": "byok-model",
  "object": "chat.completion"
}"""


class _RecordingTransport(httpx.AsyncBaseTransport):
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(
            200,
            content=_CHAT_COMPLETION,
            headers={"Content-Type": "application/json"},
            request=request,
        )


async def test_openai_compatible_reaches_the_wire_with_the_users_credential() -> None:
    """T3-AC1: the outbound call carries the caller's Authorization, not the
    server default's — asserted at the transport layer."""
    credential = ByokCredential(
        provider="openai-compatible",
        key="sk-user-fake",
        model="byok-model",
        base_url="https://example.com/v1",
    )
    byok_model = await build_byok_model(credential)
    recorder = _RecordingTransport()
    byok_model.client._transport = recorder
    try:
        result = await Agent(byok_model.model).run("hi")
    finally:
        await byok_model.client.aclose()
    assert result.output == "ok"
    assert recorder.requests[0].headers["authorization"] == "Bearer sk-user-fake"
    assert recorder.requests[0].url.host == "example.com"


async def test_openai_compatible_disables_sdk_retries() -> None:
    """T3-AC2: `AsyncOpenAI` is constructed with `max_retries == 0`."""
    credential = ByokCredential(
        provider="openai-compatible",
        key="sk-user-fake",
        model="byok-model",
        base_url="https://example.com/v1",
    )
    byok_model = await build_byok_model(credential)
    try:
        assert isinstance(byok_model.model, OpenAIChatModel)
        assert byok_model.model.client.max_retries == 0
        assert byok_model.model.client.api_key == "sk-user-fake"
    finally:
        await byok_model.client.aclose()


async def test_anthropic_routes_to_the_anthropic_adapter() -> None:
    """T3-AC2: the anthropic family builds an `AnthropicModel` carrying the
    user's key, never the server's."""
    credential = ByokCredential(
        provider="anthropic", key="sk-ant-user-fake", model="claude-test"
    )
    byok_model = await build_byok_model(credential)
    try:
        assert isinstance(byok_model.model, AnthropicModel)
        assert byok_model.model.client.api_key == "sk-ant-user-fake"
        assert byok_model.model.client.max_retries == 0
    finally:
        await byok_model.client.aclose()


def _google_api_key(model: GoogleModel) -> str:
    """The genai SDK's actual credential — not just proof a string was
    passed somewhere, but the exact value the wire request will carry
    (`_api_client.api_key` backs the `x-goog-api-key` request header)."""
    return str(model.provider.client._api_client.api_key)


async def test_gemini_routes_to_the_google_adapter() -> None:
    """T3-AC2: the gemini family builds a `GoogleModel` carrying the user's
    key, never the server's."""
    credential = ByokCredential(
        provider="gemini", key="gemini-user-fake", model="gemini-test"
    )
    byok_model = await build_byok_model(credential)
    try:
        assert isinstance(byok_model.model, GoogleModel)
        assert _google_api_key(byok_model.model) == "gemini-user-fake"
    finally:
        await byok_model.client.aclose()


async def test_gemini_never_falls_back_to_a_server_side_env_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """P1-2: `GoogleProvider` falls back to `os.getenv("GOOGLE_API_KEY")`
    only when the `api_key` it receives is falsy. With a real server-side
    env credential present, the BYOK turn must still carry the caller's own
    key — never silently substitute the environment's."""
    monkeypatch.setenv("GOOGLE_API_KEY", "server-side-env-key-should-never-be-used")
    credential = ByokCredential(
        provider="gemini", key="gemini-user-fake", model="gemini-test"
    )
    byok_model = await build_byok_model(credential)
    try:
        assert _google_api_key(byok_model.model) == "gemini-user-fake"
    finally:
        await byok_model.client.aclose()


@pytest.mark.parametrize(
    ("provider", "key", "model"),
    [
        ("openai-compatible", "sk-a", "m"),
        ("anthropic", "sk-ant-a", "claude-test"),
        ("gemini", "gemini-a", "gemini-test"),
    ],
)
async def test_every_family_is_wired_through_the_guarded_transport(
    provider: ByokProvider, key: str, model: str
) -> None:
    """Every family's client uses `GuardedAsyncTransport` (Task 1's SSRF
    guard) — there is no unguarded path to a BYOK-supplied endpoint."""
    base_url = "https://example.com/v1" if provider == "openai-compatible" else None
    credential = ByokCredential(
        provider=provider,
        key=key,
        model=model,
        base_url=base_url,
    )
    byok_model = await build_byok_model(credential)
    try:
        assert isinstance(byok_model.client._transport, GuardedAsyncTransport)
    finally:
        await byok_model.client.aclose()
