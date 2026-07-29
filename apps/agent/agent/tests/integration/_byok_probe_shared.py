"""Shared fixtures/helpers for the BYOK probe test suite (#284 Task 5).

Not a test module itself (no `test_` functions) — split out so
`test_byok_probe.py`, `test_byok_probe_error_taxonomy.py`,
`test_byok_probe_containment.py`, and `test_byok_probe_families.py` can each
stay under the project's 200-line test-file cap, mirroring the
`_byok_redaction_shared.py` pattern from Task 2.
"""

from __future__ import annotations

import socket

import httpx
import pytest
from fastapi import FastAPI

from agent.agents.byok_models import (
    ByokCredential,
    ByokModel,
    ByokProvider,
    build_byok_model,
)
from agent.tests.unit.conftest_fastapi import async_client, build_app

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

_STUB_PUBLIC_IP = "8.8.8.8"
_real_getaddrinfo = socket.getaddrinfo


def stub_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    """Hermetic DNS: the `openai-compatible` family's pre-flight
    `validate_base_url` call resolves the host for real unless patched. Only
    the fixture domain is faked — an IP-literal `base_url` (an SSRF test)
    must still resolve through the real, fast, non-network numeric path so
    the guard's own rejection is exercised, not this fixture's."""

    def _fake_getaddrinfo(
        host: str, port: int, *args: object, **kwargs: object
    ) -> list[tuple[object, ...]]:
        if host == "byok.example.test":
            return [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", (_STUB_PUBLIC_IP, port))
            ]
        return _real_getaddrinfo(host, port, *args, **kwargs)

    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo)


def error_body(message: str) -> bytes:
    return f'{{"error": {{"message": "{message}", "type": "error"}}}}'.encode()


class FixedResponseTransport(httpx.AsyncBaseTransport):
    """Returns one canned response for every request; records each one."""

    def __init__(
        self, status_code: int, content: bytes, headers: dict[str, str] | None = None
    ) -> None:
        self.status_code = status_code
        self.content = content
        self.extra_headers = headers or {}
        self.requests: list[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(
            self.status_code,
            content=self.content,
            headers={"Content-Type": "application/json", **self.extra_headers},
            request=request,
        )


class RaisingTransport(httpx.AsyncBaseTransport):
    """Raises a fixed exception on every request — simulates a connection
    failure at the transport layer, below any SDK-level HTTP status."""

    def __init__(self, exc: BaseException) -> None:
        self._exc = exc
        self.call_count = 0

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        del request
        self.call_count += 1
        raise self._exc


async def byok_model_with_transport(
    transport: httpx.AsyncBaseTransport,
    *,
    provider: ByokProvider = "openai-compatible",
    model: str = "byok-test-model",
    base_url: str | None = "https://byok.example.test/v1",
    apply_probe_cap: bool = False,
) -> ByokModel:
    """Build a real `ByokModel` (real client lifecycle), transport swapped
    post-construction — never touches the network. Test-only: production
    code installs its transport at construction time via
    `build_byok_model(..., transport_wrapper=...)` (#479 P2 review
    follow-up); reassigning `client._transport` here is the same
    already-established test double pattern `test_byok_model_construction.py`
    uses, not a route/production code path.

    `apply_probe_cap=True` (containment tests only): wraps `transport` with
    the route's own `_CappedResponseTransport` before installing it, so a
    test that mocks the route's `build_byok_model` call (and therefore
    bypasses the route's own `transport_wrapper=` argument) still exercises
    the *same* cap mechanism the real route installs — otherwise a mutation
    that dropped the cap wrapping from the route would go undetected by any
    test built on this helper (#479 P1-3 review follow-up).
    """
    credential = ByokCredential(
        provider=provider,
        key="sk-fake-secret-value",
        model=model,
        base_url=base_url,
    )
    byok_model = await build_byok_model(credential)
    if apply_probe_cap:
        from agent.interfaces.routes.byok import _CappedResponseTransport

        transport = _CappedResponseTransport(transport)
    byok_model.client._transport = transport
    return byok_model


def app() -> FastAPI:
    built, _ = build_app()
    return built


async def post_probe(built_app: FastAPI, headers: dict[str, str]) -> httpx.Response:
    async with async_client(built_app) as client:
        return await client.post("/v1/byok/probe", headers=headers)
