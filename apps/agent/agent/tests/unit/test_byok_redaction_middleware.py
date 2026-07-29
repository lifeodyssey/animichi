"""Unit tests for the BYOK credential-stripping middleware (X3, Task 2).

Spec: docs/superpowers/specs/2026-07-28-284-byok-design.md — Task 2.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response

import agent.interfaces.fastapi_service as fastapi_service_module
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.infrastructure.supabase.client import SupabaseClient
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.routes._middleware import (
    SENSITIVE_HEADERS,
    _split_sensitive_headers,
    get_raw_sensitive_header,
    register_credential_stripping_middleware,
)

FAKE_KEY = b"sk-test-0000000000000000000000000000"

# ── AC-3: null/empty header handling (unit) ─────────────────────────────────


class TestAC3NullAndEmptyHeaders:
    def test_no_byok_headers_leaves_headers_unchanged(self) -> None:
        headers = [(b"host", b"example.com"), (b"accept", b"*/*")]

        raw_values, scrubbed = _split_sensitive_headers(headers)

        assert raw_values == {}
        assert scrubbed == headers

    def test_empty_sensitive_header_value_is_not_redacted_or_stashed(self) -> None:
        headers = [(b"x-byok-key", b""), (b"host", b"example.com")]

        raw_values, scrubbed = _split_sensitive_headers(headers)

        assert raw_values == {}
        assert scrubbed == headers
        assert b"[redacted]" not in [value for _, value in scrubbed]

    def test_present_sensitive_header_is_redacted_and_stashed(self) -> None:
        headers = [(b"x-byok-key", FAKE_KEY)]

        raw_values, scrubbed = _split_sensitive_headers(headers)

        assert raw_values == {b"x-byok-key": FAKE_KEY}
        assert scrubbed == [(b"x-byok-key", b"[redacted]")]

    def test_header_name_set_is_unchanged_by_redaction(self) -> None:
        headers = [(b"x-byok-key", FAKE_KEY), (b"host", b"example.com")]

        _, scrubbed = _split_sensitive_headers(headers)

        assert [name for name, _ in scrubbed] == [name for name, _ in headers]

    def test_sensitive_headers_set_covers_byok_and_auth(self) -> None:
        assert SENSITIVE_HEADERS == frozenset(
            {"x-byok-key", "x-byok-base-url", "authorization", "cf-turnstile-response"}
        )

    def test_authorization_header_is_redacted_not_dropped(self) -> None:
        """Regression pin (#441's expired/invalid-JWT guard runs at the edge
        worker, not this container, but a future change here that *drops*
        Authorization instead of redacting it would silently change what any
        container-side consumer of this header set observes)."""
        headers = [(b"authorization", b"Bearer eyJ.fake.jwt")]

        raw_values, scrubbed = _split_sensitive_headers(headers)

        assert scrubbed == [(b"authorization", b"[redacted]")]
        assert raw_values == {b"authorization": b"Bearer eyJ.fake.jwt"}


# ── AC-8: registration order is enforced behaviourally, not by index ───────
#
# The endpoint always sees redacted headers regardless of relative order (the
# scope mutation happens before `call_next` is awaited, wherever stripping
# sits). The ordering rule only matters for an *outer* layer — one that
# inspects headers before delegating downstream, as `observability_middleware`
# could in the future. `_build_outer_probe_app` stands in for that position.


def _build_outer_probe_app(
    *, stripping_is_outermost: bool
) -> tuple[FastAPI, list[str | None]]:
    """A middleware that reads the header *before* delegating downstream,
    standing in for what an outer, header-inspecting layer would observe --
    the concrete failure mode the rev4 P1-4 correction guards against.

    ``outer_probe`` is always registered first, in source order. Starlette's
    last-registered-wins-outermost semantics mean: if ``stripping`` is
    registered *after* it (``stripping_is_outermost=True``), stripping ends
    up outside the probe; if not, the probe stays outermost and observes
    whatever the client actually sent.
    """
    app = FastAPI()
    seen_before_call_next: list[str | None] = []

    @app.middleware("http")
    async def outer_probe(
        request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        seen_before_call_next.append(request.headers.get("x-byok-key"))
        return await call_next(request)

    if stripping_is_outermost:
        register_credential_stripping_middleware(app)

    @app.get("/probe")
    async def probe() -> JSONResponse:
        return JSONResponse({"ok": True})

    return app, seen_before_call_next


class TestAC8OuterLayerOrderingSensitivity:
    async def test_outer_layer_sees_redacted_when_stripping_registered_after_it(
        self,
    ) -> None:
        """Registering the probe first then stripping second makes stripping
        outermost (last-registered wins), so the probe -- nested inside it --
        only ever observes the already-redacted scope."""
        app, seen = _build_outer_probe_app(stripping_is_outermost=True)

        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="https://test") as client:
            await client.get("/probe", headers={"X-BYOK-Key": "SECRET-VALUE"})

        assert seen == ["[redacted]"]

    async def test_outer_layer_sees_raw_value_when_registered_after_stripping(
        self,
    ) -> None:
        """rev4 P1-4: if stripping is registered *before* an outer,
        header-inspecting layer, that layer ends up outermost (last
        registered wins) and observes the raw header -- this is exactly the
        leak the rev2/rev3 "registered first (outermost)" instruction would
        have produced had it been followed literally."""
        app, seen = _build_outer_probe_app(stripping_is_outermost=False)

        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="https://test") as client:
            await client.get("/probe", headers={"X-BYOK-Key": "SECRET-VALUE"})

        assert seen == ["SECRET-VALUE"]


def test_get_raw_sensitive_header_reads_only_the_stashed_value() -> None:
    app = FastAPI()
    register_credential_stripping_middleware(app)
    captured: dict[str, bytes | None] = {}

    @app.get("/probe")
    async def probe(request: Request) -> JSONResponse:
        captured["raw"] = get_raw_sensitive_header(request, "x-byok-key")
        captured["missing"] = get_raw_sensitive_header(request, "x-byok-base-url")
        return JSONResponse({"ok": True})

    async def _run() -> None:
        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="https://test") as client:
            await client.get("/probe", headers={"X-BYOK-Key": "SECRET-VALUE"})

    import asyncio

    asyncio.run(_run())

    assert captured["raw"] == b"SECRET-VALUE"
    assert captured["missing"] is None


# ── AC-8 (Fable P1): the *real* app's registration call order, not a
#    synthetic stand-in — a silent swap in fastapi_service.py itself must
#    fail this test, which the synthetic tests above cannot detect. ────────


async def test_real_app_registration_order_redacts_before_observability_slot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Replaces `register_observability_middleware` with a probe that takes
    its *exact* call slot in `create_fastapi_app` — same position, same
    relative order versus stripping — so this pins the production call
    order in `fastapi_service.py`, not a hand-built substitute. Verified by
    manually swapping the two registration lines there: this test goes red
    (observes the raw value) when stripping is registered before
    observability instead of after."""
    seen: list[str | None] = []

    def recording_register_observability(app: FastAPI) -> None:
        @app.middleware("http")
        async def _probe(
            request: Request, call_next: RequestResponseEndpoint
        ) -> Response:
            seen.append(request.headers.get("x-byok-key"))
            return await call_next(request)

    monkeypatch.setattr(
        fastapi_service_module,
        "register_observability_middleware",
        recording_register_observability,
    )

    db = MagicMock(spec=SupabaseClient)
    runtime_api = RuntimeAPI(
        db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
    )
    app = fastapi_service_module.create_fastapi_app(runtime_api=runtime_api)

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        await client.get("/", headers={"X-BYOK-Key": "SECRET-VALUE"})

    assert seen == ["[redacted]"]
