"""D18 end-to-end transport isolation (#284 T3, P1-3①).

Split out of `test_byok_internal_calls_use_server_key.py` to keep that file
under the 200-line test-file cap. That file's kwarg-presence checks prove
`RuntimeAPI` *passes* a server-locked `title_translator`; this file proves,
with real wire traffic on two separate recording transports, that the
callable actually reaches the server credential end-to-end and the main
loop's BYOK credential never crosses into it (or vice versa) — a class of
regression a kwarg-presence check cannot catch (e.g. a bug *inside* the
injected translator that let `ctx` leak back in).
"""

from __future__ import annotations

import socket
from typing import cast
from unittest.mock import patch

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from agent.agents.byok_models import ByokCredential, build_byok_model
from agent.clients.catalog_client import CatalogClientProtocol
from agent.interfaces.public_api import RuntimeAPI

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _stub_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    """Hermetic DNS (P2①) — see `test_byok_model_construction.py` for why
    this patches `socket.getaddrinfo` directly rather than the resolver
    default."""

    def _fake_getaddrinfo(
        host: str, port: int, *_args: object, **_kwargs: object
    ) -> list[tuple[object, ...]]:
        del host
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", port))]

    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo)


_CHAT_COMPLETION = b"""{
  "id": "chatcmpl-server",
  "choices": [{
    "finish_reason": "stop",
    "index": 0,
    "message": {"content": "Title", "role": "assistant"}
  }],
  "created": 0,
  "model": "server-model",
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


async def test_end_to_end_transport_isolation_between_main_loop_and_helper() -> None:
    """A single test, real wire traffic on two separate transports — proves
    the main loop hits the BYOK credential and `translate_anime_title` hits
    the server's, with neither key ever crossing into the other's captured
    request."""
    byok_credential = ByokCredential(
        provider="openai-compatible",
        key="sk-byok-fake",
        model="byok-model",
        base_url="https://example.com/v1",
    )
    byok_model = await build_byok_model(byok_credential)
    byok_recorder = _RecordingTransport()
    byok_model.client._transport = byok_recorder

    server_recorder = _RecordingTransport()
    server_client = httpx.AsyncClient(transport=server_recorder)
    server_sdk = AsyncOpenAI(
        base_url="https://server.example.com/v1",
        api_key="sk-server-fake",
        http_client=server_client,
    )
    server_model = OpenAIChatModel(
        "server-model", provider=OpenAIProvider(openai_client=server_sdk)
    )

    api = RuntimeAPI(
        object(),
        catalog=cast(CatalogClientProtocol, object()),
        model_http_client=cast(httpx.AsyncClient, object()),
    )
    try:
        # Patch where the lookup happens, not where the function is defined:
        # `public_api` does `from agent.agents.base import resolve_model`, so a
        # patch on `agent.agents.translation.resolve_model` misses entirely and
        # the helper reaches the real endpoint — the transport records nothing
        # and this test dies on an empty `requests` list rather than a wrong
        # key. That is how it failed when the server-model choice moved out of
        # `translation._translation_run_scope` and into
        # `_server_title_translator`. Retarget this string if it moves again.
        with patch(
            "agent.interfaces.public_api.resolve_model", return_value=server_model
        ):
            translator = api._server_title_translator([])
            await translator("タイトル", "en")

        await Agent(byok_model.model).run("hi")
    finally:
        await byok_model.client.aclose()
        await server_client.aclose()

    byok_auth = byok_recorder.requests[0].headers["authorization"]
    server_auth = server_recorder.requests[0].headers["authorization"]
    assert byok_auth == "Bearer sk-byok-fake"
    assert server_auth == "Bearer sk-server-fake"
    assert "sk-server-fake" not in byok_auth
    assert "sk-byok-fake" not in server_auth
