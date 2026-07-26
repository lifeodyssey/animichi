"""Integration: /v1/photo-search full pipeline against the named fixtures.

Vision is stubbed at the provider protocol (no live API calls); everything
else — HTTP boundary, decision tree, canary, quota, resolve handoff, layer-2
merge — is the real wiring (issue #260 ACs 4, 6, 9, 10).
"""

from __future__ import annotations

import base64
import os
from datetime import UTC, datetime
from unittest.mock import MagicMock

from fastapi import FastAPI

os.environ.setdefault("MIMO_API_KEY", "integration-test-key")
os.environ.setdefault(
    "SUPABASE_DB_URL", "postgresql://test:test@localhost:5432/test"
)

from agent.agents.vision_supply_router import EndpointId, VisionProvider  # noqa: E402
from agent.config.settings import Settings  # noqa: E402
from agent.infrastructure.observability.photo_search import (  # noqa: E402
    PhotoSearchQuota,
)
from agent.interfaces.public_api import RuntimeAPI  # noqa: E402
from agent.interfaces.routes.photo_search import PhotoSearchRuntime  # noqa: E402
from agent.tests.unit.conftest_fastapi import (  # noqa: E402
    async_client,
    build_app,
    build_stub_db,
)
from agent.tests.unit.photo_search_fakes import (  # noqa: E402
    LANDSCAPE_FIXTURE,
    NEARBY_TITLE,
    UNRESOLVABLE_TITLE,
    YOURNAME_BANGUMI_ID,
    YOURNAME_FIXTURE,
    YOURNAME_TITLE,
    FakeCatalog,
    KeyedVisionStub,
    digest,
)

_YOURNAME = YOURNAME_FIXTURE.read_bytes()
_LANDSCAPE = LANDSCAPE_FIXTURE.read_bytes()
_ENDPOINT = EndpointId("byok-ep")


def _vision_stub() -> KeyedVisionStub:
    return KeyedVisionStub(
        {digest(_YOURNAME): [YOURNAME_TITLE], digest(_LANDSCAPE): []}
    )


def _app(
    settings: Settings | None = None,
    byok: VisionProvider | None = None,
    byok_capable: bool = False,
) -> tuple[FastAPI, PhotoSearchRuntime]:
    runtime_api = MagicMock(spec=RuntimeAPI)
    runtime_api._db = build_stub_db()
    app, _ = build_app(runtime_api=runtime_api, settings=settings)
    providers = {_ENDPOINT: byok} if byok is not None else {}
    runtime = PhotoSearchRuntime(
        platform_provider=_vision_stub(),
        catalog=FakeCatalog(),
        quota=PhotoSearchQuota(clock=lambda: datetime(2026, 7, 26, tzinfo=UTC)),
        byok_providers=providers,
    )
    runtime.registry.mark(_ENDPOINT, byok_capable)
    app.state.photo_search = runtime
    return app, runtime


def _body(image: bytes, gps: dict[str, float] | None = None) -> dict[str, object]:
    body: dict[str, object] = {
        "image_base64": base64.b64encode(image).decode("ascii"),
        "mime_type": "image/jpeg",
    }
    if gps is not None:
        body["gps"] = gps
    return body


async def test_yourname_fixture_resolves_to_its_pilgrimage_map() -> None:
    app, _ = _app()
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=_body(_YOURNAME))
    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "search_bangumi"
    results = payload["data"]["results"]
    assert results["bangumi_id"] == YOURNAME_BANGUMI_ID
    assert results["title"] == YOURNAME_TITLE
    assert results["rows"][0]["name"] == "須賀神社"


async def test_landscape_fixture_degrades_to_the_clarify_branch() -> None:
    app, _ = _app()
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=_body(_LANDSCAPE))
    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "clarify"
    assert payload["data"]["reason"] == "photo_unrecognized"


async def test_layer_two_merges_nearby_source_with_vision_candidates() -> None:
    app, runtime = _app()
    stub = KeyedVisionStub({digest(_LANDSCAPE): [UNRESOLVABLE_TITLE]})
    runtime.platform_provider = stub
    gps = {"lat": 35.2, "lng": 136.2}
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=_body(_LANDSCAPE, gps))
    titles = [c["title"] for c in response.json()["data"]["candidates"]]
    assert titles == [UNRESOLVABLE_TITLE, NEARBY_TITLE]


async def test_canary_miscount_falls_back_to_platform_and_demotes() -> None:
    byok = KeyedVisionStub({digest(_YOURNAME): ["wrong"]}, reported_count=4)
    app, runtime = _app(byok=byok, byok_capable=True)
    headers = {"X-User-Id": "user-1", "x-byok-endpoint": _ENDPOINT}
    async with async_client(app) as client:
        response = await client.post(
            "/v1/photo-search", json=_body(_YOURNAME), headers=headers
        )
    assert response.json()["data"]["results"]["bangumi_id"] == YOURNAME_BANGUMI_ID
    assert byok.calls == 1
    assert runtime.registry.is_vision_capable(_ENDPOINT) is False


async def test_quota_tiers_and_guidance_premises() -> None:
    app, _ = _app(settings=Settings(photo_search_quota_anon=1, photo_search_quota_member=0))
    byok_headers = {"X-User-Id": "user-1", "x-byok-endpoint": _ENDPOINT}
    async with async_client(app) as client:
        first = await client.post("/v1/photo-search", json=_body(_YOURNAME))
        second = await client.post("/v1/photo-search", json=_body(_YOURNAME))
        member = await client.post(
            "/v1/photo-search", json=_body(_YOURNAME), headers=byok_headers
        )
    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["error"]["details"]["guidance"] == "configure_vision_key"
    assert member.status_code == 429
    assert member.json()["error"]["details"]["guidance"] == "switch_vision_endpoint"
