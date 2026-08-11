"""Rejection mapping on POST /v1/chat (TURN-2/3 #949/#951).

Drives the admission verdicts through the FastAPI boundary: stale revision,
in-flight, turn-failed, and ownership collapse map to their wire envelopes
and never reach the runtime; quota exhaustion maps to the login recovery
envelope and the rejected reservation is released. The lifecycle handoff
tests live in ``test_chat_admission_handoff``.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from animichi.application.turn_admission_port import ReservationOutcome
from animichi.config.settings import Settings
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.schemas import PublicAPIResponse
from animichi.tests.unit.chat_admission_fakes import (
    ANON_HEADERS,
    ScriptedStore,
    _app,
    _post,
)
from animichi.tests.unit.conftest_fastapi import build_app, build_stub_db


async def test_stale_revision_maps_to_409() -> None:
    store = ScriptedStore(ReservationOutcome(status="stale_revision", session_id="s-1"))
    app, runtime = _app(store)
    response = await _post(
        app,
        {
            **ANON_HEADERS,
            "X-Turn-Id": "turn-9",
            "X-Session-Revision": "1",
            "X-Session-Id": "s-1",
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "stale_revision"
    assert runtime.handle.await_count == 0


async def test_in_flight_maps_to_409_and_never_reaches_the_runtime() -> None:
    store = ScriptedStore(ReservationOutcome(status="in_flight", session_id="s-1"))
    app, runtime = _app(store)
    response = await _post(
        app, {**ANON_HEADERS, "X-Turn-Id": "turn-9", "X-Session-Id": "s-1"}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "turn_in_flight"
    assert runtime.handle.await_count == 0


async def test_turn_failed_maps_to_409() -> None:
    store = ScriptedStore(ReservationOutcome(status="turn_failed", session_id="s-1"))
    app, runtime = _app(store)
    response = await _post(
        app, {**ANON_HEADERS, "X-Turn-Id": "turn-9", "X-Session-Id": "s-1"}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "turn_failed"
    assert runtime.handle.await_count == 0


async def test_ownership_collapse_maps_to_404() -> None:
    store = ScriptedStore(ReservationOutcome(status="ownership", session_id="s-1"))
    app, runtime = _app(store)
    response = await _post(
        app,
        {
            "X-User-Id": "user-1",
            "X-Turn-Id": "turn-9",
            "X-Session-Id": "s-1",
        },
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Conversation not found."
    assert runtime.handle.await_count == 0


async def test_quota_exhaustion_maps_to_the_login_recovery_envelope() -> None:
    store = ScriptedStore(ReservationOutcome(status="admitted", revision=1))
    db = build_stub_db()
    db.turn_reservation = store
    db.anon_quota = MagicMock()
    db.anon_quota.increment_and_count = AsyncMock(return_value=5)
    db.anon_quota.count_for = AsyncMock(return_value=4)
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(success=True, status="ok", intent="general_qa")
    )
    runtime.validate_session_owner = AsyncMock(return_value=None)
    runtime._db = db
    app, _ = build_app(
        runtime_api=runtime,
        db=db,
        settings=Settings(anon_daily_message_quota=3),
    )

    response = await _post(app, ANON_HEADERS)
    assert response.status_code == 403
    error = response.json()["error"]
    assert error["code"] == "anon_quota_exhausted"
    assert error["action"] == "login"
    assert "quota_resets_at" in error["data"]
    assert store.release_calls != []
    assert store.release_calls[0][:2] == (None, store.requests[0].turn_key)
