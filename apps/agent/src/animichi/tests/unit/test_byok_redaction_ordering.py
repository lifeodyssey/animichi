"""The BYOK credential-stripping middleware's registration order (X3, Task 2).

Spec: docs/specs/2026-07-28-284-byok-design.md — Task 2.

The middleware always redacts what a *nested* endpoint sees, wherever stripping
sits in the stack; ordering only matters for an outer, header-inspecting layer,
which observes whatever layer is registered last. These cases drive that
behaviourally (AC-8) instead of pinning an index — including the production call
order inside ``create_fastapi_app`` itself, which the synthetic stand-ins cannot
detect. Header-level handling is pinned in ``test_byok_redaction_headers.py``.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response

import animichi.interfaces.fastapi_service as fastapi_service_module
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.routes._middleware import (
    get_raw_sensitive_header,
    register_credential_stripping_middleware,
)


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

    db = MagicMock()
    runtime_api = RuntimeAPI(
        db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
    )
    app = fastapi_service_module.create_fastapi_app(runtime_api=runtime_api)

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        await client.get("/healthz", headers={"X-BYOK-Key": "SECRET-VALUE"})

    assert seen == ["[redacted]"]
