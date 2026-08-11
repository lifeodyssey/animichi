"""CappedResponseTransport unit tests (AGENT-2 #953).

The ≤64 KiB probe cap is enforced on both declared Content-Length and the
actual byte stream; these hermetic tests drive the transport with stub inner
transports — no network, no timing.
"""

from __future__ import annotations

from collections.abc import Callable

import httpx

from animichi.infrastructure.egress_transport import (
    PROBE_MAX_RESPONSE_BYTES,
    CappedResponseTransport,
    _ProbeResponseTooLarge,
)


class _Inner(httpx.AsyncBaseTransport):
    def __init__(
        self,
        body: bytes,
        headers: dict[str, str] | None = None,
        on_aclose: Callable[[], None] | None = None,
    ) -> None:
        self._body = body
        self._headers = headers or {}
        self._on_aclose = on_aclose

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=self._body,
            headers=self._headers,
            request=request,
        )

    async def aclose(self) -> None:
        if self._on_aclose is not None:
            self._on_aclose()


async def _roundtrip(transport: CappedResponseTransport, body: bytes) -> httpx.Response:
    async with httpx.AsyncClient(transport=transport) as client:
        return await client.get("https://byok.example.test/v1")


async def test_small_response_passes_through_unchanged() -> None:
    body = b'{"vision": true}'
    response = await _roundtrip(CappedResponseTransport(_Inner(body)), body)
    assert response.status_code == 200
    assert response.content == body


async def test_oversized_content_length_is_rejected() -> None:
    body = b"x" * (PROBE_MAX_RESPONSE_BYTES + 1)
    transport = CappedResponseTransport(_Inner(b"", {"content-length": str(len(body))}))
    try:
        await _roundtrip(transport, body)
    except _ProbeResponseTooLarge:
        pass
    else:
        raise AssertionError("expected _ProbeResponseTooLarge")


async def test_oversized_streamed_body_is_rejected_without_content_length() -> None:
    body = b"x" * (PROBE_MAX_RESPONSE_BYTES + 1)
    transport = CappedResponseTransport(_Inner(body))
    try:
        await _roundtrip(transport, body)
    except _ProbeResponseTooLarge:
        pass
    else:
        raise AssertionError("expected _ProbeResponseTooLarge")


async def test_aclose_propagates_to_the_inner_transport() -> None:
    closed: list[bool] = []

    def mark_closed() -> None:
        closed.append(True)

    transport = CappedResponseTransport(_Inner(b"ok", on_aclose=mark_closed))
    await _roundtrip(transport, b"ok")
    await transport.aclose()
    assert len(closed) >= 1


async def test_oversized_stream_without_content_length_is_rejected() -> None:
    from animichi.agents.byok_models import ByokCredential

    class _Chunks(httpx.AsyncByteStream):
        async def __aiter__(self):
            for _ in range(PROBE_MAX_RESPONSE_BYTES // 1024 + 1):
                yield b"x" * 1024

    class _StreamingInner(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, stream=_Chunks(), request=request)

    transport = CappedResponseTransport(_StreamingInner())
    try:
        await _roundtrip(transport, b"")
    except _ProbeResponseTooLarge:
        pass
    else:
        raise AssertionError("expected _ProbeResponseTooLarge")
    del ByokCredential


async def test_probe_credential_missing_base_url_fails_loudly() -> None:
    from animichi.agents.byok_models import ByokCredential
    from animichi.interfaces.services.byok_probe import ProbeModelCredential

    credential = ByokCredential(
        provider="openai-compatible",
        key="sk-fake-secret",
        model="byok-test-model",
        base_url=None,
    )
    try:
        await ProbeModelCredential().probe(credential)
    except RuntimeError as exc:
        assert "missing its required base_url" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")
