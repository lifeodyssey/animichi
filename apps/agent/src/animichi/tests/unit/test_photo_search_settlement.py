"""Admission lifecycle settlement on /v1/photo-search (TURN-2/3 #949/#951).

A scripted turn-outcome store drives the dispatch/settle/release branches:
a successful turn settles ``completed``, a pre-dispatch construction rejection
releases, a pipeline failure settles ``failed``, and a GPS payload settles
like any other turn. Runtime construction/caching lives in
``test_photo_search_runtime``.
"""

from __future__ import annotations

from dataclasses import replace
from unittest.mock import MagicMock, patch

from animichi.agents.byok_models import ByokError
from animichi.application.turn_admission_port import (
    ReservationOutcome,
    ReserveRequest,
)
from animichi.application.turn_outcome_port import SweepReport, TurnRef
from animichi.config.settings import Settings
from animichi.interfaces.routes.photo_search import PhotoSearchRuntime
from animichi.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db
from animichi.tests.unit.photo_search_fakes import FakeCatalog
from animichi.tests.unit.photo_search_route_fixtures import (
    BYOK_HEADERS,
    UsageRepo,
    body_,
    titles_model,
)


class ScriptedStore:
    """A store that returns scripted outcomes and records lifecycle calls."""

    def __init__(self, outcome: ReservationOutcome) -> None:
        self.outcome = outcome
        self.dispatched: list[tuple[str | None, str]] = []
        self.settled: list[tuple[str | None, str, str]] = []
        self.released: list[tuple[str | None, str]] = []

    async def reserve(self, request: ReserveRequest) -> ReservationOutcome:
        if self.outcome.status == "admitted":
            return replace(
                self.outcome,
                owner=request.owner,
                lease_expires_at=request.lease_expires_at,
            )
        return self.outcome

    async def dispatch(self, ref: TurnRef, *, owner: str) -> bool:
        del owner
        self.dispatched.append((ref.session_id, ref.turn_key))
        return True

    async def settle(self, ref: TurnRef, *, owner: str, outcome: str) -> bool:
        del owner
        self.settled.append((ref.session_id, ref.turn_key, outcome))
        return True

    async def release(self, ref: TurnRef, *, owner: str) -> bool:
        del owner
        self.released.append((ref.session_id, ref.turn_key))
        return True

    async def sweep(
        self, *, now: object, owner: str, batch_size: int, lease_seconds: int
    ) -> SweepReport:
        del now, owner, batch_size
        return SweepReport()


def _app_with_store(store: ScriptedStore) -> tuple[object, object]:
    db = build_stub_db()
    db.turn_reservation = store
    db.usage = UsageRepo()
    app, _ = build_app(db=db, settings=Settings())
    app.state.photo_search = PhotoSearchRuntime(
        platform_model=titles_model(["君の名は。"]), catalog=FakeCatalog()
    )
    return app, db


def _admitted() -> ScriptedStore:
    return ScriptedStore(
        ReservationOutcome(status="admitted", session_id="s-1", revision=1)
    )


async def test_complete_settles_after_a_successful_turn() -> None:
    store = _admitted()
    app, _ = _app_with_store(store)
    async with async_client(app) as client:
        response = await client.post(
            "/v1/photo-search",
            json=body_(),
            headers={"X-User-Id": "user-1", "X-User-Type": "human"},
        )
    assert response.status_code == 200
    assert len(store.settled) == 1
    assert store.settled[0][0] == "s-1"
    assert store.settled[0][2] == "completed"
    assert store.dispatched != []
    assert store.released == []


async def test_fail_releases_after_a_byok_construction_rejection() -> None:
    store = _admitted()
    app, _ = _app_with_store(store)
    with patch(
        "animichi.interfaces.routes.photo_search.build_byok_model",
        side_effect=ByokError("invalid_request", "bad credential"),
    ):
        async with async_client(app) as client:
            response = await client.post(
                "/v1/photo-search", json=body_(), headers=BYOK_HEADERS
            )
    assert response.status_code == 400
    assert len(store.released) == 1
    assert store.released[0][0] == "s-1"
    assert store.settled == []


async def test_gps_body_reaches_the_pipeline() -> None:
    store = _admitted()
    app, _ = _app_with_store(store)
    payload = body_()
    payload["gps"] = {"lat": 35.68, "lng": 139.69}
    async with async_client(app) as client:
        response = await client.post(
            "/v1/photo-search",
            json=payload,
            headers={"X-User-Id": "user-1", "X-User-Type": "human"},
        )
    assert response.status_code == 200
    assert len(store.settled) == 1
    assert store.settled[0][0] == "s-1"
    assert store.settled[0][2] == "completed"


async def test_pipeline_failure_settles_fail() -> None:
    store = _admitted()
    db = build_stub_db()
    db.turn_reservation = store
    db.usage = UsageRepo()
    app, _ = build_app(db=db, settings=Settings())
    app.state.photo_search = PhotoSearchRuntime(
        platform_model=titles_model(["君の名は。"]), catalog=FakeCatalog()
    )
    app.state.photo_search.catalog = MagicMock()
    async with async_client(app) as client:
        response = await client.post(
            "/v1/photo-search",
            json=body_(),
            headers={"X-User-Id": "user-1", "X-User-Type": "human"},
        )
    assert response.status_code == 500
    assert len(store.settled) == 1
    assert store.settled[0][0] == "s-1"
    assert store.settled[0][2] == "failed"


async def test_byok_generic_construction_error_maps_to_400() -> None:
    store = _admitted()
    app, _ = _app_with_store(store)
    with patch(
        "animichi.interfaces.routes.photo_search.build_byok_model",
        side_effect=RuntimeError("boom"),
    ):
        async with async_client(app) as client:
            response = await client.post(
                "/v1/photo-search", json=body_(), headers=BYOK_HEADERS
            )
    assert response.status_code == 400
    assert len(store.released) == 1
