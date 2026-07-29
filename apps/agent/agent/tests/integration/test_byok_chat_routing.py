"""BYOK wiring on POST /v1/chat (#284 T3).

Covers the route-level ACs: null/empty golden behaviour, the anonymous
login gate, the pre-stream invalid_request truth table, and the
close-on-raise / no-persisted-credential guarantees. Model-family
construction itself is covered by `test_byok_model_construction.py`;
`test_byok_internal_calls_use_server_key.py` covers the D18 boundary.
"""

from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI
from pydantic_ai.models import Model

from agent.agents.byok_models import ByokModel
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.schemas import PublicAPIResponse
from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

pytestmark = pytest.mark.integration

HUMAN_HEADERS = {"X-User-Id": "user-1", "X-User-Type": "human"}
ANON_HEADERS = {
    "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
    "X-User-Type": "anonymous",
}
BYOK_HEADERS = {
    "X-BYOK-Provider": "openai-compatible",
    "X-BYOK-Key": "sk-fake-secret-value",
    "X-BYOK-Model": "byok-test-model",
    "X-BYOK-Base-Url": "https://byok.example.test/v1",
}


def _body() -> dict[str, object]:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "京吹"}]}
        ]
    }


def _db() -> MagicMock:
    db = build_stub_db()
    db.usage = MagicMock()
    db.usage.accumulate_usage = AsyncMock(return_value=None)
    db.usage.total_cost_usd = AsyncMock(return_value=0.0)
    return db


def _runtime(db: MagicMock, *, side_effect: BaseException | None = None) -> MagicMock:
    runtime = MagicMock(spec=RuntimeAPI)
    response = PublicAPIResponse(
        success=True, status="ok", intent="plan_route", message="ルートだよ。"
    )
    runtime.handle = AsyncMock(return_value=response, side_effect=side_effect)
    runtime.validate_session_owner = AsyncMock(return_value=None)
    runtime._db = db
    return runtime


def _app(runtime: MagicMock, db: MagicMock) -> FastAPI:
    app, _ = build_app(runtime_api=runtime, db=db)
    return app


async def _post(app: FastAPI, headers: dict[str, str]) -> httpx.Response:
    async with async_client(app) as client:
        return await client.post("/v1/chat", json=_body(), headers=headers)


def _fake_byok_model() -> tuple[ByokModel, AsyncMock]:
    fake_client = AsyncMock(spec=httpx.AsyncClient)
    fake_model = cast(Model, MagicMock(spec=Model))
    return ByokModel(model=fake_model, client=fake_client), fake_client


def _patched_build(byok_model: ByokModel) -> object:
    return patch(
        "agent.interfaces.routes.chat.build_byok_model",
        AsyncMock(return_value=byok_model),
    )


async def test_no_byok_headers_resolves_to_default_model() -> None:
    """T3-AC4: absent BYOK headers must leave existing behaviour unchanged."""
    db = _db()
    runtime = _runtime(db)
    app = _app(runtime, db)
    response = await _post(app, HUMAN_HEADERS)
    assert response.status_code == 200
    assert runtime.handle.await_args.kwargs["model"] is None
    assert runtime.handle.await_args.kwargs["is_byok"] is False


async def test_byok_headers_build_a_concrete_model_and_mark_the_turn() -> None:
    """T3-AC1/AC2: a BYOK turn passes the constructed model, flagged as BYOK."""
    db = _db()
    runtime = _runtime(db)
    app = _app(runtime, db)
    byok_model, fake_client = _fake_byok_model()
    with _patched_build(byok_model):
        response = await _post(app, HUMAN_HEADERS | BYOK_HEADERS)
    assert response.status_code == 200
    assert runtime.handle.await_args.kwargs["model"] is byok_model.model
    assert runtime.handle.await_args.kwargs["is_byok"] is True
    fake_client.aclose.assert_awaited_once()


async def test_client_is_closed_even_when_the_turn_raises() -> None:
    """T3-AC8: the guarded client is closed even when the turn raises."""
    db = _db()
    runtime = _runtime(db, side_effect=RuntimeError("boom"))
    app = _app(runtime, db)
    byok_model, fake_client = _fake_byok_model()
    with _patched_build(byok_model):
        response = await _post(app, HUMAN_HEADERS | BYOK_HEADERS)
    assert response.status_code == 200  # SSE stream still opens; error is in-band
    fake_client.aclose.assert_awaited_once()


async def test_anonymous_caller_with_byok_headers_is_rejected() -> None:
    """T3/T4: BYOK is login-gated — anonymous + BYOK headers is refused."""
    db = _db()
    runtime = _runtime(db)
    app = _app(runtime, db)
    response = await _post(app, ANON_HEADERS | BYOK_HEADERS)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "byok_requires_login"
    assert runtime.handle.await_count == 0


async def test_anonymous_caller_without_byok_headers_is_unaffected() -> None:
    db = _db()
    runtime = _runtime(db)
    app = _app(runtime, db)
    response = await _post(app, ANON_HEADERS)
    assert response.status_code == 200


@pytest.mark.parametrize(
    "bad_headers",
    [
        {"X-BYOK-Provider": "openai-compatible", "X-BYOK-Key": "   "},
        {"X-BYOK-Provider": "not-a-real-provider", "X-BYOK-Key": "sk-x"},
        {
            "X-BYOK-Provider": "anthropic",
            "X-BYOK-Key": "sk-x",
            "X-BYOK-Base-Url": "https://example.test",
        },
        {"X-BYOK-Provider": "openai-compatible", "X-BYOK-Key": "sk-x"},
    ],
)
async def test_malformed_byok_headers_are_rejected_pre_stream(
    bad_headers: dict[str, str],
) -> None:
    """T3-AC5: the truth table rejects as 400 `invalid_request`, never a 500,
    never a silent fallthrough to the default model."""
    db = _db()
    runtime = _runtime(db)
    app = _app(runtime, db)
    response = await _post(app, HUMAN_HEADERS | bad_headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"
    assert runtime.handle.await_count == 0


async def test_byok_credential_never_reaches_app_state() -> None:
    """T3-AC9: no reference on `app.state` after the turn."""
    db = _db()
    runtime = _runtime(db)
    app = _app(runtime, db)
    byok_model, _fake_client = _fake_byok_model()
    with _patched_build(byok_model):
        await _post(app, HUMAN_HEADERS | BYOK_HEADERS)
    state_repr = repr(vars(app.state))
    assert "sk-fake-secret-value" not in state_repr
    assert not hasattr(app.state, "byok_credential")
