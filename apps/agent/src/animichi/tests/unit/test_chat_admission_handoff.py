"""Lifecycle handoff on POST /v1/chat (TURN-3 #951).

A fresh admission hands the lease-guarded lifecycle to the runtime via
``outcome``/``turn_ref``/``owner`` while the route settles nothing itself;
a replay is admitted without a reservation; and the bounded sweep runs on
startup and before the next admission.
"""

from __future__ import annotations

from animichi.application.turn_admission_port import ReservationOutcome
from animichi.tests.unit.chat_admission_fakes import (
    ANON_HEADERS,
    ScriptedStore,
    _app,
    _post,
)


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
