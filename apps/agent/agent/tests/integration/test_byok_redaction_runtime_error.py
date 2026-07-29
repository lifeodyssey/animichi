"""BYOK redaction — a runtime exception's SSE frame carries no credential.

Split out of `test_byok_redaction_inbound.py` (Task 2, T2-AC5) so this one
`/v1/chat` round-trip — the only test in that suite needing a real,
resolvable `base_url` (every other test there routes through `/__test/echo`
or `/__test/crash`, never exercising the real SSRF pre-flight) — can carry
its own hermetic-DNS fixture without pushing that file over the 200-line cap.
"""

from __future__ import annotations

import socket
from unittest.mock import AsyncMock

import pytest

from agent.tests.integration import _byok_redaction_shared as shared
from agent.tests.unit.conftest_fastapi import async_client, build_app

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _stub_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    """Hermetic DNS (P3-a): the real `build_byok_model` this test exercises
    does a real pre-flight resolution of `X-BYOK-Base-Url`. Mirrors Task 1's
    own `test_egress_dns_resolution.py` pattern of patching
    `socket.getaddrinfo` directly — `default_resolve`'s `resolver` parameter
    is bound at function-definition time, so reassigning the `egress_guard`
    module attribute would have no effect on an already-bound default.
    """

    def _fake_getaddrinfo(
        host: str, port: int, *_args: object, **_kwargs: object
    ) -> list[tuple[object, ...]]:
        del host
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", port))]

    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo)


async def test_runtime_error_stream_frame_has_no_credential() -> None:
    runtime = shared.success_runtime()
    runtime.handle = AsyncMock(side_effect=RuntimeError(f"boom {shared.FAKE_KEY}"))
    app, _ = build_app(runtime_api=runtime)

    async with async_client(app) as client:
        response = await client.post(
            "/v1/chat",
            json=shared.chat_body(),
            headers={
                "X-User-Id": "user-1",
                # #284 T3: the shared fixture's base_url is a deliberately
                # non-resolving domain for the leak-proofing assertions in
                # `test_byok_redaction_inbound.py`; here it must actually
                # resolve (via the stubbed DNS above) so the request reaches
                # the mocked `runtime.handle` instead of failing SSRF
                # pre-flight.
                **shared.BYOK_HEADER_FAMILIES["openai-compatible"],
                "X-BYOK-Base-Url": "https://example.com/v1",
            },
        )

    assert response.status_code == 200
    assert shared.FAKE_KEY not in response.text
    assert '"errorText"' in response.text
