"""Integration: photo-search quota tiers and their guidance premises."""

from __future__ import annotations

from agent.config.settings import Settings
from agent.tests.integration.photo_search_contract_fixtures import (
    BYOK_HEADERS,
    YOURNAME,
    app_,
    body_,
)
from agent.tests.unit.conftest_fastapi import async_client


async def test_quota_tiers_and_guidance_premises() -> None:
    app, _ = app_(
        settings=Settings(photo_search_quota_anon=1, photo_search_quota_member=0)
    )
    async with async_client(app) as client:
        first = await client.post("/v1/photo-search", json=body_(YOURNAME))
        second = await client.post("/v1/photo-search", json=body_(YOURNAME))
        member = await client.post(
            "/v1/photo-search", json=body_(YOURNAME), headers=BYOK_HEADERS
        )
    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["error"]["details"]["guidance"] == "configure_vision_key"
    assert member.status_code == 429
    assert member.json()["error"]["details"]["guidance"] == "switch_vision_endpoint"
