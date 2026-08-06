"""Unit tests for health, CORS, and app state routes.

Covers: GET /healthz, CORS middleware, create_fastapi_app state.
"""

from __future__ import annotations

import importlib
import re
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from pytest import MonkeyPatch

from animichi.config.settings import Settings
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.routes import health
from animichi.tests.unit.conftest_fastapi import (
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
# byok-storage.ts (#467) sends, or the browser never lets them reach this
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
    # cors_allowed_origin's validator rejects "*" outside app_env=="development"
    # (issue #498 follow-up), and this app_env=="testing" sentinel is not "development".
    settings = Settings(app_env="testing", cors_allowed_origin="http://localhost:3000")

    app, _ = build_app(runtime_api=runtime_api, db=mock_db, settings=settings)

    async with async_client(app) as client:
        resp = await client.get("/healthz")

    assert resp.status_code == 200
    assert app.state.runtime_api is runtime_api
    assert app.state.settings is settings
    assert app.state.db_client is mock_db


# ---------------------------------------------------------------------------
# #494: /healthz git_commit / git_branch resolve baked build_info.py -> env
# vars -> git shell-out -> "unknown". The values are captured at module load,
# so each test sets up its condition, reloads the module, then asserts
# through the endpoint.
# ---------------------------------------------------------------------------


async def test_healthz_reports_baked_build_info(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setitem(
        sys.modules,
        "animichi.build_info",
        SimpleNamespace(GIT_COMMIT="baked0ab", GIT_BRANCH="baked-branch"),
    )
    importlib.reload(health)
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.get("/healthz")

    body = resp.json()
    assert body["git_commit"] == "baked0ab"
    assert body["git_branch"] == "baked-branch"


async def test_healthz_reports_git_env_vars(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("GIT_COMMIT", "env0000")
    monkeypatch.setenv("GIT_BRANCH", "env-branch")
    importlib.reload(health)
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.get("/healthz")

    body = resp.json()
    assert body["git_commit"] == "env0000"
    assert body["git_branch"] == "env-branch"


async def test_healthz_git_fallback_returns_real_commit(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.delenv("GIT_COMMIT", raising=False)
    monkeypatch.delenv("GIT_BRANCH", raising=False)
    monkeypatch.delitem(sys.modules, "animichi.build_info", raising=False)
    importlib.reload(health)
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.get("/healthz")

    body = resp.json()
    assert re.fullmatch(r"[0-9a-f]{7,}", body["git_commit"])


async def test_healthz_git_absent_returns_unknown(
    monkeypatch: MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("GIT_COMMIT", raising=False)
    monkeypatch.delenv("GIT_BRANCH", raising=False)
    monkeypatch.delitem(sys.modules, "animichi.build_info", raising=False)
    monkeypatch.chdir(tmp_path)
    importlib.reload(health)
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.get("/healthz")

    body = resp.json()
    assert body["git_commit"] == "unknown"
    assert body["git_branch"] == "unknown"
