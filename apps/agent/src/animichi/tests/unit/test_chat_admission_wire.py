"""Route-level admission wire behavior on POST /v1/chat (TURN-2 #949).

Drives :class:`TurnAdmission` through the FastAPI boundary with a scripted
store: the admission headers (``x-turn-id`` / ``x-session-revision`` /
``x-session-digest``) reach the store, rejection verdicts map to their wire
envelopes, and an admitted turn completes its reservation after the runtime
returns.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
from fastapi import FastAPI

from animichi.application.turn_admission_port import (
    ReservationOutcome,
    ReserveRequest,
)
from animichi.config.settings import Settings
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.schemas import PublicAPIResponse
from animichi.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

ANON_HEADERS = {
    "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
    "X-User-Type": "anonymous",
}


class ScriptedStore:
    """A store that returns scripted outcomes and records calls."""

    def __init__(self, outcome: ReservationOutcome) -> None:
        self.outcome = outcome
        self.requests: list[ReserveRequest] = []
        self.completed: list[tuple[str | None, str]] = []
        self.failed: list[tuple[str | None, str]] = []

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome:
        self.requests.append(request)
        return self.outcome

    async def complete(self, *, session_id: str | None, turn_key: str) -> None:
        self.completed.append((session_id, turn_key))

    async def fail(self, *, session_id: str | None, turn_key: str) -> None:
        self.failed.append((session_id, turn_key))


def _body() -> dict[str, object]:
    return {
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "京吹"}]}
        ]
    }


def _app(store: ScriptedStore) -> tuple[FastAPI, MagicMock]:
    db = build_stub_db()
    db.turn_reservation = store
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(
        return_value=PublicAPIResponse(success=True, status="ok", intent="general_qa")
    )
    runtime.validate_session_owner = AsyncMock(return_value=None)
    runtime._db = db
    app, _ = build_app(runtime_api=runtime, db=db, settings=Settings())
    return app, runtime


async def _post(app: FastAPI, headers: dict[str, str] | None = None) -> httpx.Response:
    async with async_client(app) as client:
        return await client.post("/v1/chat", json=_body(), headers=headers)


async def test_admission_headers_reach_the_store_and_turn_completes() -> None:
    store = ScriptedStore(
        ReservationOutcome(status="admitted", session_id="s-1", revision=2)
    )
    app, runtime = _app(store)
    headers = {
        **ANON_HEADERS,
        "X-Turn-Id": "turn-9",
        "X-Session-Revision": "1",
        "X-Session-Digest": "deadbeef",
        "X-Session-Id": "s-1",
    }
    response = await _post(app, headers)
    assert response.status_code == 200
    request = store.requests[0]
    assert request.turn_key == "turn-9"
    assert request.session_id == "s-1"
    assert request.expected_revision == 1
    assert request.session_digest == "deadbeef"
    assert runtime.handle.await_count == 1
    assert store.completed == [("s-1", "turn-9")]


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


async def test_replay_admits_without_recompleting() -> None:
    store = ScriptedStore(
        ReservationOutcome(status="replay_completed", session_id="s-1", revision=2)
    )
    app, runtime = _app(store)
    response = await _post(
        app, {**ANON_HEADERS, "X-Turn-Id": "turn-9", "X-Session-Id": "s-1"}
    )
    assert response.status_code == 200
    assert runtime.handle.await_count == 1
    assert store.completed == []


async def test_quota_exhaustion_maps_to_the_login_recovery_envelope() -> None:
    store = ScriptedStore(ReservationOutcome(status="admitted", revision=1))
    db = build_stub_db()
    db.turn_reservation = store
    db.anon_quota = MagicMock()
    db.anon_quota.increment_and_count = AsyncMock(return_value=4)
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
    assert store.failed == [(None, store.requests[0].turn_key)]
