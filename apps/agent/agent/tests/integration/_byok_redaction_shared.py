"""Shared fixtures/helpers for the BYOK redaction test suite (#284 Task 2).

Not a test module itself (no `test_` functions) — split out so
`test_byok_redaction_inbound.py` and `test_byok_redaction_outbound.py` can
each stay under the project's 200-line test-file cap, mirroring the
`_egress_tls_stub.py` pattern from Task 1.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import logfire
import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from logfire.testing import TestExporter
from opentelemetry.sdk.trace.export import SimpleSpanProcessor

from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.schemas import PublicAPIResponse
from agent.tests.unit.conftest_fastapi import build_stub_db

FAKE_KEY = "sk-test-0000000000000000000000000000"
SENSITIVE_PATH = "/v1/very/sensitive/customer/path"
FAKE_BASE_URL_QUERY = "apikey=leak-me-if-you-can"

BYOK_HEADER_FAMILIES: dict[str, dict[str, str]] = {
    "openai-compatible": {
        "X-BYOK-Provider": "openai-compatible",
        "X-BYOK-Key": FAKE_KEY,
        "X-BYOK-Model": "byok-test-model",
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


def chat_body(text: str = "京吹") -> dict[str, object]:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": text}]}
        ]
    }


def success_runtime() -> MagicMock:
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.validate_session_owner = AsyncMock(return_value=None)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(
            success=True, status="ok", intent="search_bangumi", message="ok"
        )
    )
    runtime._db = build_stub_db()
    return runtime


def build_logfire_sinks(
    monkeypatch: pytest.MonkeyPatch,
    *,
    scrubbing_enabled: bool = True,
) -> TestExporter:
    """Route real ``logfire.configure()`` calls to an in-memory span sink,
    with ``LOGFIRE_TOKEN`` present so ``_instrument_logfire`` actually runs.

    Each test file defines its own thin ``@pytest.fixture`` wrapper around
    this (pytest resolves fixtures by name in the *local* module, so a bare
    fixture object can't be re-exported via import without ruff flagging the
    import as unused) — see ``logfire_sinks`` in each `test_byok_redaction_*`
    file.

    ``scrubbing_enabled=False`` disables Logfire's own built-in scrubber
    entirely (T2-AC2), so a passing "no leak" assertion can only be
    attributed to the homegrown stripping middleware. No metrics reader is
    wired in: nothing in this suite asserts on metrics, and an unused one is
    dead weight.
    """
    exporter = TestExporter()
    real_configure = logfire.configure

    def configure_with_test_sinks(**kwargs: object) -> logfire.Logfire:
        del kwargs
        return real_configure(
            send_to_logfire=False,
            console=False,
            scrubbing=False if not scrubbing_enabled else None,
            additional_span_processors=[SimpleSpanProcessor(exporter)],
        )

    monkeypatch.setattr(logfire, "configure", configure_with_test_sinks)
    monkeypatch.setenv("LOGFIRE_TOKEN", "test-token")
    return exporter


def all_span_text(exporter: TestExporter) -> str:
    """Dump every span's name, attributes, *and events* to one search blob.

    Attributes alone miss a real sink: OTel records an uncaught exception as
    a span *event* named ``exception``, with the message/stacktrace on the
    event's own attributes, not the span's — a leak embedded in a raised
    exception's text would be invisible to an attributes-only scan.
    """
    chunks: list[str] = []
    for span in exporter.exported_spans:
        chunks.append(span.name)
        if span.attributes:
            chunks.append(str(dict(span.attributes)))
        for event in span.events:
            chunks.append(event.name)
            if event.attributes:
                chunks.append(str(dict(event.attributes)))
    return "\n".join(chunks)


def add_crash_route(app: FastAPI) -> None:
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


def add_echo_route(app: FastAPI) -> None:
    """A non-crashing adversarial route: reflects what it sees into the
    response body *and* a span attribute. Needed because the "happy path"
    through `/v1/chat` never touches the BYOK headers at all (the mocked
    runtime ignores them) — a "no leak" assertion there would pass whether
    or not the stripping middleware ran. This route makes the happy-path
    assertion for AC2/AC5 genuinely sensitive to the middleware being
    present, by giving the raw value one real chance to reach an
    observable sink."""

    @app.get("/__test/echo")
    async def echo(request: Request) -> JSONResponse:
        seen_key = request.headers.get("x-byok-key") or ""
        seen_base_url = request.headers.get("x-byok-base-url") or ""
        with logfire.span("echo_probe") as span:
            span.set_attribute("seen_key", seen_key)
            span.set_attribute("seen_base_url", seen_base_url)
        return JSONResponse({"seen_key": seen_key, "seen_base_url": seen_base_url})
