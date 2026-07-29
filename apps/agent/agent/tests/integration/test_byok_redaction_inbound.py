"""Integration tests for the BYOK credential-stripping middleware — inbound leg.

Spec: docs/superpowers/specs/2026-07-28-284-byok-design.md — Task 2 (X3),
T2-AC1, AC2, AC4, AC5. (AC3 and AC8 are unit-level; AC6/AC7, the outbound
leg, live in `test_byok_redaction_outbound.py`.)

Every "happy path" test here routes through either `/__test/crash` or
`/__test/echo` (see `_byok_redaction_shared.py`), not `/v1/chat` alone: the
mocked `RuntimeAPI.handle` never touches the BYOK headers, so a bare
`/v1/chat` round-trip would report "no leak" whether or not the stripping
middleware ran. These routes give the raw header one real chance to reach an
observable sink, and each assertion checks *both* the absence of the raw
value and the presence of `[redacted]`, so removing the middleware turns
every test in this file red, not just the exception-path ones.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from logfire.testing import TestExporter
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from structlog.testing import capture_logs

from agent.tests.integration import _byok_redaction_shared as shared
from agent.tests.unit.conftest_fastapi import async_client, build_app


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


@pytest.fixture
def logfire_sinks_no_scrubbing(monkeypatch: pytest.MonkeyPatch) -> TestExporter:
    return shared.build_logfire_sinks(monkeypatch, scrubbing_enabled=False)


class TestAC1CredentialNeverLeaksAcrossFamilies:
    @pytest.mark.parametrize("family", list(shared.BYOK_HEADER_FAMILIES))
    async def test_unhandled_exception_leaks_nowhere(
        self, family: str, logfire_sinks: TestExporter
    ) -> None:
        app, _ = build_app(runtime_api=shared.success_runtime())
        shared.add_crash_route(app)

        with capture_logs() as captured_logs:
            async with async_client(app) as client:
                response = await client.get(
                    "/__test/crash", headers=shared.BYOK_HEADER_FAMILIES[family]
                )

        assert response.status_code == 500
        assert response.json()["error"]["code"] == "internal_error"
        sinks = (response.text, shared.all_span_text(logfire_sinks), str(captured_logs))
        for sink in sinks:
            assert shared.FAKE_KEY not in sink
            assert shared.SENSITIVE_PATH not in sink
        assert "[redacted]" in str(captured_logs)

    @pytest.mark.parametrize("family", list(shared.BYOK_HEADER_FAMILIES))
    async def test_echo_route_leaks_nowhere(
        self, family: str, logfire_sinks: TestExporter
    ) -> None:
        app, _ = build_app(runtime_api=shared.success_runtime())
        shared.add_echo_route(app)

        async with async_client(app) as client:
            response = await client.get(
                "/__test/echo", headers=shared.BYOK_HEADER_FAMILIES[family]
            )

        assert response.status_code == 200
        for sink in (response.text, shared.all_span_text(logfire_sinks)):
            assert shared.FAKE_KEY not in sink
            assert shared.SENSITIVE_PATH not in sink
        assert response.json()["seen_key"] in ("", "[redacted]")


class TestAC2HoldsWithLogfireScrubbingDisabled:
    async def test_echo_route_leaks_nowhere_without_logfire_scrubbing(
        self, logfire_sinks_no_scrubbing: TestExporter
    ) -> None:
        app, _ = build_app(runtime_api=shared.success_runtime())
        shared.add_echo_route(app)

        async with async_client(app) as client:
            response = await client.get(
                "/__test/echo",
                headers=shared.BYOK_HEADER_FAMILIES["openai-compatible"],
            )

        assert response.status_code == 200
        assert response.json()["seen_key"] == "[redacted]"
        for sink in (response.text, shared.all_span_text(logfire_sinks_no_scrubbing)):
            assert shared.FAKE_KEY not in sink
            assert shared.SENSITIVE_PATH not in sink


class TestAC4ErrorEnvelopeNeverLeaksTheCredential:
    async def test_internal_error_envelope_and_exception_log_are_clean(self) -> None:
        app, _ = build_app(runtime_api=shared.success_runtime())
        shared.add_crash_route(app)

        with capture_logs() as captured_logs:
            async with async_client(app) as client:
                response = await client.get(
                    "/__test/crash",
                    headers={
                        "X-User-Id": "user-1",
                        **shared.BYOK_HEADER_FAMILIES["openai-compatible"],
                    },
                )

        assert response.status_code == 500
        assert response.json()["error"]["code"] == "internal_error"
        assert shared.FAKE_KEY not in response.text

        [event] = [
            entry
            for entry in captured_logs
            if entry.get("event") == "fastapi_unhandled_exception"
        ]
        assert shared.FAKE_KEY not in event["error"]
        assert "[redacted]" in event["error"]


class TestAC5ResponseHeadersAndSseFramesNeverLeak:
    async def test_echo_route_response_headers_and_body_never_leak(self) -> None:
        app, _ = build_app(runtime_api=shared.success_runtime())
        shared.add_echo_route(app)

        async with async_client(app) as client:
            response = await client.get(
                "/__test/echo",
                headers=shared.BYOK_HEADER_FAMILIES["openai-compatible"],
            )

        assert shared.FAKE_KEY not in str(response.headers)
        assert response.json()["seen_key"] == "[redacted]"


class TestLogfireTokenGatesRealInstrumentation:
    """O3: pins that `LOGFIRE_TOKEN` presence/absence is load-bearing for
    `_instrument_logfire`, not a decorative sentinel — this goes through
    `create_fastapi_app()`'s real gate, unlike the outbound-leg tests which
    activate instrumentation directly."""

    def test_token_present_instruments_httpx(self, logfire_sinks: TestExporter) -> None:
        del logfire_sinks
        build_app(runtime_api=shared.success_runtime())
        assert HTTPXClientInstrumentor().is_instrumented_by_opentelemetry is True

    def test_token_absent_does_not_instrument_httpx(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)
        build_app(runtime_api=shared.success_runtime())
        assert HTTPXClientInstrumentor().is_instrumented_by_opentelemetry is False
