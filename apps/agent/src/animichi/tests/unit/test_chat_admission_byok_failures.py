"""BYOK failure paths on POST /v1/chat (TURN-2 #949).

Companion to ``test_chat_admission_wire.py``: the BYOK-model construction
failures, the fail-settlement when construction dies after an admission, and
the background client-close wiring. Scripted store + patched model builder.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from fastapi import FastAPI

from animichi.application.turn_admission_port import ReservationOutcome
from animichi.config.settings import Settings
from animichi.interfaces.public_api import RuntimeAPI
from animichi.tests.unit.conftest_fastapi import async_client
from animichi.tests.unit.test_chat_admission_wire import (
    ScriptedStore,
    _app,
    _body,
)

BYOK_HEADERS = {
    "X-User-Id": "user-test-0001",
    "X-User-Type": "user",
    "X-Turn-Id": "turn-9",
    "X-Session-Id": "s-1",
    "X-BYOK-Provider": "openai-compatible",
    "X-BYOK-Key": "sk-fake-secret",
    "X-BYOK-Model": "fake-model",
    "X-BYOK-Base-Url": "https://byok.example.test/v1",
}


async def _post(app: FastAPI, headers: dict[str, str]) -> httpx.Response:
    async with async_client(app) as client:
        return await client.post("/v1/chat", json=_body(), headers=headers)


async def test_byok_construction_failure_returns_400_and_releases_the_reservation() -> (
    None
):
    store = ScriptedStore(
        ReservationOutcome(status="admitted", session_id="s-1", revision=1)
    )
    app, runtime = _app(store)
    with patch(
        "animichi.interfaces.routes.chat.build_byok_model",
        side_effect=RuntimeError("boom"),
    ):
        response = await _post(app, BYOK_HEADERS)
    assert response.status_code == 400
    assert store.release_calls == [("s-1", "turn-9", store.requests[0].owner)]
    assert runtime.handle.await_count == 0


async def test_byok_construction_byok_error_maps_to_400() -> None:
    from animichi.agents.byok_models import ByokError

    store = ScriptedStore(
        ReservationOutcome(status="admitted", session_id="s-1", revision=1)
    )
    app, _ = _app(store)
    with patch(
        "animichi.interfaces.routes.chat.build_byok_model",
        side_effect=ByokError("invalid_key", "bad credential"),
    ):
        response = await _post(app, BYOK_HEADERS)
    assert response.status_code == 400
    assert response.json()["error"]["message"] == "bad credential"


async def test_admitted_turn_with_byok_closes_the_client_in_background() -> None:
    store = ScriptedStore(
        ReservationOutcome(status="admitted", session_id="s-1", revision=1)
    )
    app, runtime = _app(store)
    client = MagicMock()
    client.aclose = AsyncMock()
    with (
        patch(
            "animichi.interfaces.routes.chat.build_byok_model",
            return_value=MagicMock(model=MagicMock(), client=client),
        ),
        patch(
            "animichi.interfaces.routes.chat.BackgroundTask",
            return_value=MagicMock(),
        ) as background,
    ):
        response = await _post(app, BYOK_HEADERS)
    assert response.status_code == 200
    background.assert_called_once_with(client.aclose)
    assert runtime.handle.await_count == 1


async def test_runtime_failure_after_admission_does_not_settle_at_the_route() -> None:
    """Settlement is TurnOutcome/handle-owned since TURN-3 — the route must
    not call fail/complete on a runtime failure, only hand the lifecycle to
    the runtime via ``outcome``."""
    from animichi.tests.unit.conftest_fastapi import build_app, build_stub_db

    store = ScriptedStore(
        ReservationOutcome(status="admitted", session_id="s-1", revision=1)
    )
    db = build_stub_db()
    db.turn_reservation = store
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(side_effect=RuntimeError("boom"))
    runtime.validate_session_owner = AsyncMock(return_value=None)
    runtime._db = db
    app, _ = build_app(runtime_api=runtime, db=db, settings=Settings())
    with patch(
        "animichi.interfaces.routes.chat.build_byok_model",
        return_value=MagicMock(model=MagicMock(), client=MagicMock()),
    ):
        response = await _post(app, BYOK_HEADERS)
    assert response.status_code == 200
    assert store.settle_calls == []
    assert store.release_calls == []
    assert runtime.handle.await_args.kwargs["outcome"] is not None
