"""Route-level admission wire behavior on POST /v1/chat (TURN-2/3 #949/#951).

Drives :class:`TurnOutcome` through the FastAPI boundary with a scripted
store: the admission headers reach the store, rejection verdicts map to their
wire envelopes, a fresh admission hands the lease-guarded lifecycle to the
runtime (via ``outcome``/``turn_ref``/``owner``), a replay is admitted
without a reservation, and route-owned settlement is gone — the route only
releases a never-dispatched turn when BYOK construction dies.
"""

from __future__ import annotations

from dataclasses import replace
from unittest.mock import AsyncMock, MagicMock

import httpx
from fastapi import FastAPI

from animichi.application.turn_admission_port import (
    ReservationOutcome,
    ReserveRequest,
)
from animichi.application.turn_outcome_port import SweepReport, TurnRef
from animichi.config.settings import Settings
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.schemas import PublicAPIResponse
from animichi.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

ANON_HEADERS = {
    "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
    "X-User-Type": "anonymous",
}


class ScriptedStore:
    """A store that returns scripted outcomes and records lifecycle calls."""

    def __init__(self, outcome: ReservationOutcome) -> None:
        self.outcome = outcome
        self.requests: list[ReserveRequest] = []
        self.dispatch_calls: list[tuple[str | None, str, str | None]] = []
        self.settle_calls: list[tuple[str | None, str, str | None, str]] = []
        self.release_calls: list[tuple[str | None, str, str | None]] = []
        self.sweep_calls: list[int] = []

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome:
        self.requests.append(request)
        if self.outcome.status == "admitted":
            return replace(
                self.outcome,
                owner=request.owner,
                lease_expires_at=request.lease_expires_at,
            )
        return self.outcome

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        self.dispatch_calls.append((ref.session_id, ref.turn_key, owner))
        return True

    async def settle(self, ref: TurnRef, *, owner: str, outcome: str) -> bool:
        self.settle_calls.append((ref.session_id, ref.turn_key, owner, outcome))
        return True

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        self.release_calls.append((ref.session_id, ref.turn_key, owner))
        return True

    async def sweep(self, *, now: object, owner: str, batch_size: int) -> SweepReport:
        del now, owner
        self.sweep_calls.append(batch_size)
        return SweepReport()


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


async def test_admission_headers_reach_the_store_and_the_turn_is_handed_to_handle() -> (
    None
):
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
    handle_kwargs = runtime.handle.await_args.kwargs
    assert handle_kwargs["outcome"] is not None
    assert handle_kwargs["owner"] == store.requests[0].owner
    # Route-owned settlement is gone: nothing settles at the route layer.
    assert store.settle_calls == []


async def test_startup_and_next_admission_run_the_bounded_sweep() -> None:
    store = ScriptedStore(
        ReservationOutcome(status="admitted", session_id="s-1", revision=2)
    )
    app, runtime = _app(store)
    await _post(app, {**ANON_HEADERS, "X-Turn-Id": "turn-9", "X-Session-Id": "s-1"})
    assert store.sweep_calls  # startup sweep ran; pre-admission sweep runs too


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


async def test_replay_admits_without_a_reservation() -> None:
    store = ScriptedStore(
        ReservationOutcome(status="replay_completed", session_id="s-1", revision=2)
    )
    app, runtime = _app(store)
    response = await _post(
        app, {**ANON_HEADERS, "X-Turn-Id": "turn-9", "X-Session-Id": "s-1"}
    )
    assert response.status_code == 200
    assert runtime.handle.await_count == 1
    handle_kwargs = runtime.handle.await_args.kwargs
    assert handle_kwargs["outcome"] is None
    assert handle_kwargs["owner"] is None


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
