"""Unit tests for health, CORS, and app state routes.

Covers: GET /healthz, CORS middleware, create_fastapi_app state.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from agent.config.settings import Settings
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.interfaces.public_api import RuntimeAPI
from agent.tests.unit.conftest_fastapi import (
    async_client,
    build_app,
    build_stub_db,
)

# ---------------------------------------------------------------------------
# AC 1: GET /healthz returns 200 with {status, service} shape
# ---------------------------------------------------------------------------


async def test_healthz_returns_ok_with_status_and_service() -> None:
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.get("/healthz")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "animichi-runtime"


# ---------------------------------------------------------------------------
# AC 8: CORS middleware allows configured origin
# ---------------------------------------------------------------------------


async def test_cors_middleware_allows_configured_origin() -> None:
    settings = Settings(cors_allowed_origin="https://seichijunrei.com")
    app, _ = build_app(settings=settings)
    async with async_client(app) as client:
        resp = await client.options(
            "/v1/runtime",
            headers={
                "Origin": "https://seichijunrei.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type,X-User-Id",
            },
        )

    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://seichijunrei.com"
    assert "POST" in resp.headers.get("access-control-allow-methods", "")


# ---------------------------------------------------------------------------
# BYOK (#284 Task 2): CORS preflight must allow the X-BYOK-* headers
# byokStorage.ts (#467) sends, or the browser never lets them reach this
# container at all.
# ---------------------------------------------------------------------------


async def test_cors_preflight_allows_byok_headers() -> None:
    settings = Settings(cors_allowed_origin="https://seichijunrei.com")
    app, _ = build_app(settings=settings)
    async with async_client(app) as client:
        resp = await client.options(
            "/v1/chat",
            headers={
                "Origin": "https://seichijunrei.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": (
                    "X-BYOK-Provider,X-BYOK-Key,X-BYOK-Model,X-BYOK-Base-Url"
                ),
            },
        )

    assert resp.status_code == 200
    allowed = resp.headers.get("access-control-allow-headers", "").lower()
    for header in ("x-byok-provider", "x-byok-key", "x-byok-model", "x-byok-base-url"):
        assert header in allowed


# ---------------------------------------------------------------------------
# AC 9: create_fastapi_app sets app.state correctly
# ---------------------------------------------------------------------------


async def test_app_state_accessible_when_injected() -> None:
    mock_db = build_stub_db()
    runtime_api = RuntimeAPI(
        mock_db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
    )
    settings = Settings(app_env="testing")

    app, _ = build_app(runtime_api=runtime_api, db=mock_db, settings=settings)

    async with async_client(app) as client:
        resp = await client.get("/healthz")

    assert resp.status_code == 200
    assert app.state.runtime_api is runtime_api
    assert app.state.settings is settings
    assert app.state.db_client is mock_db
