"""Pins the construction-order requirement left as a P3 backlog item on #474.

`GuardedAsyncTransport.__init__` excludes itself from Logfire/OTel's global
httpx instrumentation by unwrapping whatever is currently patched onto
`httpx.AsyncHTTPTransport.handle_async_request`. `logfire.instrument_httpx()`
applies that patch at the *class* level — so a transport built **before**
`instrument_httpx()` runs has nothing to unwrap yet, and the later global
patch still lands on it. Production always calls `setup_logfire()` at app
startup, long before any per-request BYOK client is built, so this ordering
holds by construction — but nothing asserted it. This test proves the wrong
order actually leaks (transport IS instrumented), and the right order (every
other BYOK test in this suite) stays clean.
"""

from __future__ import annotations

import ssl
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator

import logfire
import pytest
from logfire.testing import TestExporter
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

from agent.infrastructure import egress_guard
from agent.infrastructure.egress_transport import build_guarded_async_client
from agent.tests.integration import _byok_redaction_shared as shared
from agent.tests.integration._egress_tls_stub import (
    TEST_HOSTNAME,
    TlsProbeServer,
    write_self_signed_cert,
)

pytestmark = pytest.mark.integration


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


@pytest.fixture(scope="session")
def tls_cert_files(tmp_path_factory: pytest.TempPathFactory) -> tuple[str, str]:
    directory = tmp_path_factory.mktemp("byok-ordering-tls")
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


async def test_client_built_before_instrumentation_is_not_protected(
    logfire_sinks: TestExporter,
    tls_stub_server: TlsProbeServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The wrong order: build the guarded client, *then* instrument httpx.

    Production never does this (instrumentation happens once at startup,
    long before any per-request client), but this proves the ordering is
    load-bearing rather than incidental — a future refactor that reversed it
    would leak silently without a test like this one.
    """
    _allow_loopback(monkeypatch, tls_stub_server.port)
    trust_ctx = ssl.create_default_context(cafile=tls_stub_server.cert_path)
    client = build_guarded_async_client(
        resolver=_resolver(["127.0.0.1"]), verify=trust_ctx
    )

    logfire.configure()
    logfire.instrument_httpx()
    logfire_sinks.clear()

    await client.get(
        f"https://{TEST_HOSTNAME}:{tls_stub_server.port}{shared.SENSITIVE_PATH}"
    )
    await client.aclose()

    span_text = shared.all_span_text(logfire_sinks)
    assert shared.SENSITIVE_PATH in span_text
