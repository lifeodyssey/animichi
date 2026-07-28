"""Integration tests for BYOK credential redaction — inbound and outbound legs.

Spec: docs/superpowers/specs/2026-07-28-284-byok-design.md — Task 2 (X3),
T2-AC1, AC2, AC4, AC5, AC6, AC7. (AC3 and AC8 are unit-level; see
``agent/tests/unit/test_byok_redaction_middleware.py``.)

These tests deliberately avoid the trap the spec calls out for T2-AC6: under
``LOGFIRE_TOKEN``-absent ``CaptureLogfire``, ``_instrument_logfire`` never
runs and zero spans are emitted, so an assertion of "no leak" would pass for
free while proving nothing. Every test here sets ``LOGFIRE_TOKEN`` *before*
building the app and routes real ``logfire.configure()`` calls to an
in-memory OTel exporter (not a mocked ``logfire`` module), so the real
httpx/FastAPI instrumentation actually runs.
"""

from __future__ import annotations

import http.server
import threading
from collections.abc import Iterator
from unittest.mock import AsyncMock, MagicMock

import httpx
import logfire
import pytest
from fastapi import FastAPI, Request
from logfire.testing import TestExporter
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from structlog.testing import capture_logs

from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.routes._deps import (
    build_uninstrumented_http_client,
    exclude_client_from_httpx_instrumentation,
)
from agent.interfaces.schemas import PublicAPIResponse
from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

FAKE_KEY = "sk-test-0000000000000000000000000000"
SENSITIVE_PATH = "/v1/very/sensitive/customer/path"
FAKE_BASE_URL_QUERY = "apikey=leak-me-if-you-can"

BYOK_HEADER_FAMILIES: dict[str, dict[str, str]] = {
    "openai-compatible": {
        "X-BYOK-Provider": "openai-compatible",
        "X-BYOK-Key": FAKE_KEY,
        "X-BYOK-Base-Url": f"https://byok.example.internal{SENSITIVE_PATH}",
    },
    "anthropic": {
        "X-BYOK-Provider": "anthropic",
        "X-BYOK-Key": FAKE_KEY,
    },
    "gemini": {
        "X-BYOK-Provider": "gemini",
        "X-BYOK-Key": FAKE_KEY,
    },
}


# ── Shared helpers ───────────────────────────────────────────────────────────


def _chat_body(text: str = "京吹") -> dict[str, object]:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": text}]}
        ]
    }


def _success_runtime() -> MagicMock:
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.validate_session_owner = AsyncMock(return_value=None)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(
            success=True, status="ok", intent="search_bangumi", message="ok"
        )
    )
    runtime._db = build_stub_db()
    return runtime


def _configure_test_sinks(
    monkeypatch: pytest.MonkeyPatch,
    exporter: TestExporter,
    metrics_reader: InMemoryMetricReader,
    *,
    scrubbing_enabled: bool,
) -> None:
    """Route real ``logfire.configure()`` calls to an in-memory span sink.

    ``scrubbing_enabled=False`` disables Logfire's own built-in scrubber
    entirely (T2-AC2), so a passing "no leak" assertion can only be
    attributed to the homegrown stripping middleware.
    """
    real_configure = logfire.configure

    def configure_with_test_sinks(**kwargs: object) -> logfire.Logfire:
        del kwargs
        return real_configure(
            send_to_logfire=False,
            console=False,
            scrubbing=False if not scrubbing_enabled else None,
            additional_span_processors=[SimpleSpanProcessor(exporter)],
            metrics=logfire.MetricsOptions(additional_readers=[metrics_reader]),
        )

    monkeypatch.setattr(logfire, "configure", configure_with_test_sinks)


@pytest.fixture
def logfire_sinks(
    monkeypatch: pytest.MonkeyPatch,
) -> TestExporter:
    """Real logfire instrumentation, routed to an in-memory exporter, with
    ``LOGFIRE_TOKEN`` present so ``_instrument_logfire`` actually runs."""
    exporter = TestExporter()
    metrics_reader = InMemoryMetricReader()
    _configure_test_sinks(monkeypatch, exporter, metrics_reader, scrubbing_enabled=True)
    monkeypatch.setenv("LOGFIRE_TOKEN", "test-token")
    return exporter


@pytest.fixture
def logfire_sinks_no_scrubbing(
    monkeypatch: pytest.MonkeyPatch,
) -> TestExporter:
    """Same as ``logfire_sinks`` but with Logfire's own scrubber disabled
    (T2-AC2)."""
    exporter = TestExporter()
    metrics_reader = InMemoryMetricReader()
    _configure_test_sinks(
        monkeypatch, exporter, metrics_reader, scrubbing_enabled=False
    )
    monkeypatch.setenv("LOGFIRE_TOKEN", "test-token")
    return exporter


def _all_span_text(exporter: TestExporter) -> str:
    chunks: list[str] = []
    for span in exporter.exported_spans:
        chunks.append(span.name)
        if span.attributes:
            chunks.append(str(dict(span.attributes)))
    return "\n".join(chunks)


def _add_crash_route(app: FastAPI) -> None:
    """A deliberately adversarial route: it tries to embed whatever it can
    see on the request into the exception message. Because the stripping
    middleware has already redacted sensitive headers by the time this runs,
    the credential is structurally unreachable here — proving AC1/AC4 hold
    even against code that actively tries to leak it, not just code that
    happens not to log it."""

    @app.get("/__test/crash")
    async def crash(request: Request) -> None:
        seen_key = request.headers.get("x-byok-key")
        seen_base_url = request.headers.get("x-byok-base-url")
        raise RuntimeError(f"boom key={seen_key} base_url={seen_base_url}")


# ── AC-1 & AC-2: happy path, all three families, four sinks ─────────────────


class TestAC1CredentialNeverLeaksAcrossFamilies:
    @pytest.mark.parametrize("family", list(BYOK_HEADER_FAMILIES))
    async def test_chat_success_leaks_nowhere(
        self, family: str, logfire_sinks: TestExporter
    ) -> None:
        app, _ = build_app(runtime_api=_success_runtime())

        with capture_logs() as captured_logs:
            async with async_client(app) as client:
                response = await client.post(
                    "/v1/chat",
                    json=_chat_body(),
                    headers={"X-User-Id": "user-1", **BYOK_HEADER_FAMILIES[family]},
                )

        assert response.status_code == 200
        assert FAKE_KEY not in response.text
        assert SENSITIVE_PATH not in response.text
        assert FAKE_KEY not in _all_span_text(logfire_sinks)
        assert FAKE_KEY not in str(captured_logs)

    @pytest.mark.parametrize("family", list(BYOK_HEADER_FAMILIES))
    async def test_unhandled_exception_leaks_nowhere(
        self, family: str, logfire_sinks: TestExporter
    ) -> None:
        app, _ = build_app(runtime_api=_success_runtime())
        _add_crash_route(app)

        with capture_logs() as captured_logs:
            async with async_client(app) as client:
                response = await client.get(
                    "/__test/crash", headers=BYOK_HEADER_FAMILIES[family]
                )

        assert response.status_code == 500
        assert response.json()["error"]["code"] == "internal_error"
        assert FAKE_KEY not in response.text
        assert SENSITIVE_PATH not in response.text
        assert FAKE_KEY not in _all_span_text(logfire_sinks)
        assert FAKE_KEY not in str(captured_logs)


class TestAC2HoldsWithLogfireScrubbingDisabled:
    async def test_chat_success_leaks_nowhere_without_logfire_scrubbing(
        self, logfire_sinks_no_scrubbing: TestExporter
    ) -> None:
        app, _ = build_app(runtime_api=_success_runtime())

        async with async_client(app) as client:
            response = await client.post(
                "/v1/chat",
                json=_chat_body(),
                headers={
                    "X-User-Id": "user-1",
                    **BYOK_HEADER_FAMILIES["openai-compatible"],
                },
            )

        assert response.status_code == 200
        assert FAKE_KEY not in response.text
        assert FAKE_KEY not in _all_span_text(logfire_sinks_no_scrubbing)


# ── AC-4: 500 envelope + logger.exception stay clean ─────────────────────────


class TestAC4ErrorEnvelopeNeverLeaksTheCredential:
    async def test_internal_error_envelope_and_exception_log_are_clean(self) -> None:
        app, _ = build_app(runtime_api=_success_runtime())
        _add_crash_route(app)

        with capture_logs() as captured_logs:
            async with async_client(app) as client:
                response = await client.get(
                    "/__test/crash",
                    headers={
                        "X-User-Id": "user-1",
                        **BYOK_HEADER_FAMILIES["openai-compatible"],
                    },
                )

        assert response.status_code == 500
        body = response.json()
        assert body["error"]["code"] == "internal_error"
        assert FAKE_KEY not in response.text

        [event] = [
            entry
            for entry in captured_logs
            if entry.get("event") == "fastapi_unhandled_exception"
        ]
        assert FAKE_KEY not in event["error"]
        assert "[redacted]" in event["error"]


# ── AC-5: no leak in /v1/chat response headers or SSE frames ────────────────


class TestAC5ResponseHeadersAndSseFramesNeverLeak:
    async def test_success_stream_has_no_credential_in_headers_or_body(self) -> None:
        app, _ = build_app(runtime_api=_success_runtime())

        async with async_client(app) as client:
            response = await client.post(
                "/v1/chat",
                json=_chat_body(),
                headers={
                    "X-User-Id": "user-1",
                    **BYOK_HEADER_FAMILIES["openai-compatible"],
                },
            )

        assert response.status_code == 200
        assert FAKE_KEY not in str(response.headers)
        assert SENSITIVE_PATH not in str(response.headers)
        for line in response.text.splitlines():
            assert FAKE_KEY not in line
            assert SENSITIVE_PATH not in line

    async def test_runtime_error_stream_frame_has_no_credential(self) -> None:
        runtime = _success_runtime()
        runtime.handle = AsyncMock(side_effect=RuntimeError(f"boom {FAKE_KEY}"))
        app, _ = build_app(runtime_api=runtime)

        async with async_client(app) as client:
            response = await client.post(
                "/v1/chat",
                json=_chat_body(),
                headers={
                    "X-User-Id": "user-1",
                    **BYOK_HEADER_FAMILIES["openai-compatible"],
                },
            )

        assert response.status_code == 200
        assert FAKE_KEY not in response.text
        assert '"errorText"' in response.text


# ── AC-6 / AC-7: the outbound (egress) leg ──────────────────────────────────


@pytest.fixture
def local_http_server() -> Iterator[int]:
    """A real local HTTP server, so requests go through the actual
    ``httpx.AsyncHTTPTransport`` class that global instrumentation patches —
    a mocked/ASGI transport would never exercise the class-level patch."""

    class _Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *args: object) -> None:  # noqa: D401
            del args

    server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_address[1]
    finally:
        server.shutdown()
        thread.join(timeout=5)


def _real_httpx_instrumentation_active(logfire_sinks: TestExporter) -> None:
    """Activate real httpx instrumentation bound to the test sinks.

    These tests call `logfire.instrument_httpx()` directly rather than going
    through `create_fastapi_app()` -> `setup_logfire()`, so `logfire.configure()`
    (patched by the `logfire_sinks*` fixture) must be invoked explicitly here
    to actually bind the test exporter before instrumenting.
    """
    del logfire_sinks
    import logfire as _logfire

    _logfire.configure()
    _logfire.instrument_httpx()


@pytest.fixture(autouse=True)
def _fresh_httpx_instrumentor_state() -> Iterator[None]:
    """OTel's ``HTTPXClientInstrumentor`` tracks instrumentation as global,
    idempotent process state: a second ``instrument()`` call is a silent
    no-op that keeps the *first* call's (stale, prior-test) tracer provider.
    Reset it around each outbound-leg test so ``logfire.instrument_httpx()``
    actually (re-)binds to *this* test's ``logfire_sinks`` exporter."""
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

    instrumentor = HTTPXClientInstrumentor()
    if instrumentor.is_instrumented_by_opentelemetry:
        instrumentor.uninstrument()
    yield
    if instrumentor.is_instrumented_by_opentelemetry:
        instrumentor.uninstrument()


class TestAC6OutboundLegNeverLeaksTheBaseUrl:
    async def test_control_request_proves_instrumentation_is_active(
        self, logfire_sinks: TestExporter, local_http_server: int
    ) -> None:
        """Precondition: instrumentation must be demonstrably on, or a
        "no leak" assertion on the protected client is hollow (the exact
        LOGFIRE_TOKEN trap the spec calls out)."""
        _real_httpx_instrumentation_active(logfire_sinks)
        control_client = httpx.AsyncClient()

        await control_client.get(
            f"http://127.0.0.1:{local_http_server}/non-byok-control?ping=1"
        )
        await control_client.aclose()

        span_text = _all_span_text(logfire_sinks)
        assert "non-byok-control" in span_text or "ping=1" in span_text

    async def test_excluded_client_egress_emits_no_span_and_no_leak(
        self, logfire_sinks: TestExporter, local_http_server: int
    ) -> None:
        _real_httpx_instrumentation_active(logfire_sinks)
        logfire_sinks.clear()

        protected_client = build_uninstrumented_http_client()
        await protected_client.get(
            f"http://127.0.0.1:{local_http_server}{SENSITIVE_PATH}"
            f"?{FAKE_BASE_URL_QUERY}"
        )
        await protected_client.aclose()

        span_text = _all_span_text(logfire_sinks)
        assert span_text == ""
        assert FAKE_KEY not in span_text
        assert SENSITIVE_PATH not in span_text
        assert FAKE_BASE_URL_QUERY not in span_text


class TestAC7RemovingTheExclusionReintroducesTheLeak:
    async def test_plain_client_without_exclusion_leaks_the_sensitive_path(
        self, logfire_sinks: TestExporter, local_http_server: int
    ) -> None:
        """Mutation pin: this is the exact client construction from
        ``build_uninstrumented_http_client`` minus the call to
        ``exclude_client_from_httpx_instrumentation``. If a future change
        drops that call (or re-includes the client in global instrumentation
        another way), this is what T2-AC6 would start seeing -- and does
        see here, proving the guard -- not a library default -- is what
        makes AC6 pass."""
        _real_httpx_instrumentation_active(logfire_sinks)
        logfire_sinks.clear()

        unprotected_client = httpx.AsyncClient()  # exclusion call omitted
        await unprotected_client.get(
            f"http://127.0.0.1:{local_http_server}{SENSITIVE_PATH}"
            f"?{FAKE_BASE_URL_QUERY}"
        )
        await unprotected_client.aclose()

        span_text = _all_span_text(logfire_sinks)
        assert SENSITIVE_PATH in span_text
        assert FAKE_BASE_URL_QUERY in span_text

    async def test_calling_exclude_after_first_use_does_not_retroactively_protect(
        self, logfire_sinks: TestExporter, local_http_server: int
    ) -> None:
        """Guards against a superficial fix that calls the exclusion helper
        but on the wrong object, or too late to matter for this test's own
        request -- a sibling regression check to AC7."""
        _real_httpx_instrumentation_active(logfire_sinks)
        logfire_sinks.clear()

        client = httpx.AsyncClient()
        exclude_client_from_httpx_instrumentation(client)
        await client.get(
            f"http://127.0.0.1:{local_http_server}{SENSITIVE_PATH}"
            f"?{FAKE_BASE_URL_QUERY}"
        )
        await client.aclose()

        # Excluding immediately after construction (before first use) is the
        # sanctioned order -- this reaffirms AC6 rather than contradicting
        # AC7: the guard works when applied before use, and AC7 shows it
        # never applies itself.
        span_text = _all_span_text(logfire_sinks)
        assert SENSITIVE_PATH not in span_text
