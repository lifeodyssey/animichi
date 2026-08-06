"""Integration: /v1/photo-search core resolve/degrade/layer-2 contract.

BYOK and quota topics live in `test_photo_search_contract_byok.py` /
`test_photo_search_contract_quota.py` — see `photo_search_contract_fixtures.py`
for the shared model/app/body builders.
"""

from __future__ import annotations

from animichi.tests.integration.photo_search_contract_fixtures import (
    LANDSCAPE,
    YOURNAME,
    app_,
    body_,
    keyed_model,
)
from animichi.tests.unit.conftest_fastapi import async_client
from animichi.tests.unit.photo_search_fakes import (
    NEARBY_TITLE,
    UNRESOLVABLE_TITLE,
    YOURNAME_BANGUMI_ID,
    YOURNAME_TITLE,
    digest,
)


async def test_yourname_fixture_resolves_to_its_pilgrimage_map() -> None:
    app, _ = app_()
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=body_(YOURNAME))
    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "search_bangumi"
    results = payload["data"]["results"]
    assert results["bangumi_id"] == YOURNAME_BANGUMI_ID
    assert results["title"] == YOURNAME_TITLE
    assert results["rows"][0]["name"] == "須賀神社"


async def test_landscape_fixture_degrades_to_the_clarify_branch() -> None:
    app, _ = app_()
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=body_(LANDSCAPE))
    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "clarify"
    assert payload["data"]["reason"] == "photo_unrecognized"


async def test_layer_two_merges_nearby_source_with_vision_candidates() -> None:
    app, runtime = app_()
    model, _ = keyed_model({digest(LANDSCAPE): [UNRESOLVABLE_TITLE]})
    runtime.platform_model = model
    gps = {"lat": 35.2, "lng": 136.2}
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=body_(LANDSCAPE, gps))
    titles = [c["title"] for c in response.json()["data"]["candidates"]]
    assert titles == [UNRESOLVABLE_TITLE, NEARBY_TITLE]
