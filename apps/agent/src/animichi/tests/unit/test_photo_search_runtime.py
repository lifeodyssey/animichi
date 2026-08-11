"""Photo-search runtime construction on /v1/photo-search (TURN-2/3 #949/#951).

The photo-search runtime is built on demand and then cached, an existing
catalog client is reused, and a missing lifespan HTTP client fails closed.
Admission lifecycle settlement lives in ``test_photo_search_settlement``.
"""

from __future__ import annotations

import httpx

from animichi.config.settings import Settings
from animichi.interfaces.routes.photo_search import PhotoSearchRuntime
from animichi.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db
from animichi.tests.unit.photo_search_route_fixtures import body_


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
