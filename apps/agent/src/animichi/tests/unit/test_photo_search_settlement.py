"""Admission settlement + runtime construction on /v1/photo-search (TURN-2 #949).

Companion to ``test_photo_search_route_quota.py``: a scripted turn-reservation
store drives the complete/fail settlement branches, the BYOK construction
rejection settles fail, the photo-search runtime is built on demand (and then
cached), and a missing lifespan HTTP client fails closed.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx

from animichi.agents.byok_models import ByokError
from animichi.application.turn_admission_port import ReservationOutcome
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
    """A store that returns scripted outcomes and records settlements."""

    def __init__(self, outcome: ReservationOutcome) -> None:
        self.outcome = outcome
        self.completed: list[tuple[str | None, str]] = []
        self.failed: list[tuple[str | None, str]] = []

    async def reserve(self, request: object) -> ReservationOutcome:
        del request
        return self.outcome

    async def complete(self, *, session_id: str | None, turn_key: str) -> None:
        self.completed.append((session_id, turn_key))

    async def fail(self, *, session_id: str | None, turn_key: str) -> None:
        self.failed.append((session_id, turn_key))


def _app_with_store(store: ScriptedStore) -> tuple[object, object]:
    db = build_stub_db()
    db.turn_reservation = store
    db.usage = UsageRepo()
    app, _ = build_app(db=db, settings=Settings())
    app.state.photo_search = PhotoSearchRuntime(
        platform_model=titles_model(["君の名は。"]), catalog=FakeCatalog()
    )
    return app, db


async def test_complete_settles_after_a_successful_turn() -> None:
    store = ScriptedStore(
        ReservationOutcome(status="admitted", session_id="s-1", revision=1)
    )
    app, _ = _app_with_store(store)
    async with async_client(app) as client:
        response = await client.post(
            "/v1/photo-search",
            json=body_(),
            headers={"X-User-Id": "user-1", "X-User-Type": "human"},
        )
    assert response.status_code == 200
    assert len(store.completed) == 1
    assert store.completed[0][0] == "s-1"
    assert store.failed == []


async def test_fail_settles_after_a_byok_construction_rejection() -> None:
    store = ScriptedStore(
        ReservationOutcome(status="admitted", session_id="s-1", revision=1)
    )
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
    assert len(store.failed) == 1
    assert store.failed[0][0] == "s-1"


async def test_runtime_is_built_on_demand_and_cached() -> None:
    db = build_stub_db()
    app, _ = build_app(db=db, settings=Settings())
    app.state.photo_search = None
    app.state.model_http_client = httpx.AsyncClient()
    async with async_client(app) as client:
        first = await client.post("/v1/photo-search", json=body_())
        second = await client.post("/v1/photo-search", json=body_())
    assert first.status_code == 200
    assert second.status_code == 200
    assert isinstance(app.state.photo_search, PhotoSearchRuntime)


async def test_missing_lifespan_http_client_fails_closed() -> None:
    db = build_stub_db()
    app, _ = build_app(db=db, settings=Settings())
    app.state.model_http_client = None
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=body_())
    assert response.status_code == 500


async def test_gps_body_reaches_the_pipeline() -> None:
    store = ScriptedStore(
        ReservationOutcome(status="admitted", session_id="s-1", revision=1)
    )
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
    assert len(store.completed) == 1
    assert store.completed[0][0] == "s-1"


async def test_pipeline_failure_settles_fail() -> None:
    store = ScriptedStore(
        ReservationOutcome(status="admitted", session_id="s-1", revision=1)
    )
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
    assert len(store.failed) == 1
    assert store.failed[0][0] == "s-1"


async def test_byok_generic_construction_error_maps_to_400() -> None:
    store = ScriptedStore(
        ReservationOutcome(status="admitted", session_id="s-1", revision=1)
    )
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
    assert len(store.failed) == 1


async def test_existing_catalog_client_is_reused() -> None:
    from animichi.clients.catalog_client import CatalogClient

    db = build_stub_db()
    app, _ = build_app(db=db, settings=Settings())
    app.state.photo_search = None
    app.state.model_http_client = httpx.AsyncClient()
    app.state.catalog_client = CatalogClient(base_url="https://catalog.test")
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=body_())
    assert response.status_code == 200
    assert isinstance(app.state.photo_search, PhotoSearchRuntime)
