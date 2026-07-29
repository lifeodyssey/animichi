"""Integration tests for the BYOK egress instrumentation exclusion — outbound leg.

Spec: docs/superpowers/specs/2026-07-28-284-byok-design.md — Task 2 (X3),
T2-AC6, AC7.

These tests deliberately avoid the trap the spec calls out for T2-AC6: under
``LOGFIRE_TOKEN``-absent ``CaptureLogfire``, ``_instrument_logfire`` never
runs and zero spans are emitted, so an assertion of "no leak" would pass for
free while proving nothing. Every test here activates real httpx
instrumentation bound to an in-memory OTel exporter (not a mocked ``logfire``
module) before asserting anything.

The protected client is built through `egress_transport.build_guarded_async_client`
— Task 1's SSRF-guard factory, which is also the *only* sanctioned way to
build a BYOK client — reusing Task 1's own TLS stub server (`_egress_tls_stub.py`)
and its `_is_address_accepted`/`ALLOWED_PORTS` test bypass, so this exercises
the real production factory rather than a hand-rolled substitute.
"""

from __future__ import annotations

import http.server
import ssl
import threading
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator

import httpx
import logfire
import pytest
from logfire.testing import TestExporter
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

from agent.infrastructure import egress_guard, egress_transport
from agent.infrastructure.egress_transport import build_guarded_async_client
from agent.tests.integration import _byok_redaction_shared as shared
from agent.tests.integration._egress_tls_stub import (
    TEST_HOSTNAME,
    TlsProbeServer,
    write_self_signed_cert,
)


@pytest.fixture(autouse=True)
def _fresh_httpx_instrumentor_state() -> Iterator[None]:
    instrumentor = HTTPXClientInstrumentor()
    if instrumentor.is_instrumented_by_opentelemetry:
        instrumentor.uninstrument()
    yield
    if instrumentor.is_instrumented_by_opentelemetry:
        instrumentor.uninstrument()


@pytest.fixture
def logfire_sinks(monkeypatch: pytest.MonkeyPatch) -> TestExporter:
    return shared.build_logfire_sinks(monkeypatch)


def _activate_real_httpx_instrumentation() -> None:
    logfire.configure()
    logfire.instrument_httpx()


@pytest.fixture
def local_http_server() -> Iterator[int]:
    """A plain local HTTP server for the control (non-BYOK) request only —
    proves instrumentation is on in general, without the SSRF guard."""

    class _Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *args: object) -> None:
            del args

    server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1]
    finally:
        server.shutdown()
        thread.join(timeout=5)


@pytest.fixture(scope="session")
def tls_cert_files(tmp_path_factory: pytest.TempPathFactory) -> tuple[str, str]:
    directory = tmp_path_factory.mktemp("byok-egress-tls")
    return write_self_signed_cert(directory)


@pytest.fixture
async def tls_stub_server(
    tls_cert_files: tuple[str, str],
) -> AsyncIterator[TlsProbeServer]:
    cert_path, key_path = tls_cert_files
    server = TlsProbeServer(cert_path, key_path)
    await server.start()
    try:
        yield server
    finally:
        await server.aclose()


def _resolver(addresses: list[str]) -> Callable[[str, int], Awaitable[list[str]]]:
    async def _resolve(_host: str, _port: int) -> list[str]:
        return addresses

    return _resolve


def _allow_loopback(monkeypatch: pytest.MonkeyPatch, port: int) -> None:
    monkeypatch.setattr(egress_guard, "ALLOWED_PORTS", frozenset({port}))
    monkeypatch.setattr(egress_guard, "_is_address_accepted", lambda _ip: True)


class TestAC6OutboundLegNeverLeaksTheBaseUrl:
    async def test_control_request_proves_instrumentation_is_active(
        self, logfire_sinks: TestExporter, local_http_server: int
    ) -> None:
        """Precondition: instrumentation must be demonstrably on, or a
        "no leak" assertion on the protected client is hollow (the exact
        LOGFIRE_TOKEN trap the spec calls out)."""
        _activate_real_httpx_instrumentation()
        control_client = httpx.AsyncClient()

        await control_client.get(
            f"http://127.0.0.1:{local_http_server}/non-byok-control?ping=1"
        )
        await control_client.aclose()

        span_text = shared.all_span_text(logfire_sinks)
        assert "non-byok-control" in span_text or "ping=1" in span_text

    async def test_guarded_client_egress_emits_no_span_and_no_leak(
        self,
        logfire_sinks: TestExporter,
        tls_stub_server: TlsProbeServer,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _allow_loopback(monkeypatch, tls_stub_server.port)
        _activate_real_httpx_instrumentation()
        logfire_sinks.clear()

        trust_ctx = ssl.create_default_context(cafile=tls_stub_server.cert_path)
        client = build_guarded_async_client(
            resolver=_resolver(["127.0.0.1"]), verify=trust_ctx
        )
        await client.get(
            f"https://{TEST_HOSTNAME}:{tls_stub_server.port}"
            f"{shared.SENSITIVE_PATH}?{shared.FAKE_BASE_URL_QUERY}"
        )
        await client.aclose()

        span_text = shared.all_span_text(logfire_sinks)
        assert span_text == ""
        assert shared.SENSITIVE_PATH not in span_text
        assert shared.FAKE_BASE_URL_QUERY not in span_text


class TestAC7RemovingTheExclusionReintroducesTheLeak:
    async def test_disabling_the_exclusion_call_reintroduces_the_leak(
        self,
        logfire_sinks: TestExporter,
        tls_stub_server: TlsProbeServer,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Mutation pin: monkeypatches the *production* factory's internal
        exclusion call to a no-op, then calls the real, unmodified
        `build_guarded_async_client()`. If a future change drops that call
        (or the wiring breaks), this is what T2-AC6 would start seeing — and
        does see here — proving the guard, not a library default, is what
        makes AC6 pass."""
        _allow_loopback(monkeypatch, tls_stub_server.port)
        monkeypatch.setattr(
            egress_transport, "_exclude_from_httpx_instrumentation", lambda client: None
        )
        _activate_real_httpx_instrumentation()
        logfire_sinks.clear()

        trust_ctx = ssl.create_default_context(cafile=tls_stub_server.cert_path)
        client = build_guarded_async_client(
            resolver=_resolver(["127.0.0.1"]), verify=trust_ctx
        )
        await client.get(
            f"https://{TEST_HOSTNAME}:{tls_stub_server.port}"
            f"{shared.SENSITIVE_PATH}?{shared.FAKE_BASE_URL_QUERY}"
        )
        await client.aclose()

        span_text = shared.all_span_text(logfire_sinks)
        assert shared.SENSITIVE_PATH in span_text
        assert shared.FAKE_BASE_URL_QUERY in span_text
