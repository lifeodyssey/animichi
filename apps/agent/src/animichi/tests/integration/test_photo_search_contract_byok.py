"""Integration: BYOK-first resolution and BYOK-failure fallback, end to end."""

from __future__ import annotations

from pydantic_ai.messages import ModelMessage, ModelResponse
from pydantic_ai.models.function import AgentInfo, FunctionModel

from animichi.tests.integration.photo_search_contract_fixtures import (
    BYOK_HEADERS,
    YOURNAME,
    app_,
    body_,
    fake_byok_model,
    keyed_model,
    patched_build,
    vision_model,
)
from animichi.tests.unit.conftest_fastapi import async_client
from animichi.tests.unit.photo_search_fakes import YOURNAME_BANGUMI_ID, digest


async def test_byok_answer_resolves_the_pilgrimage_map_without_a_platform_call() -> (
    None
):
    """The BYOK-first contract, end to end: a working BYOK model answers and
    the platform model (which would answer differently) is never touched."""
    app, runtime = app_()
    platform_model, platform_calls = keyed_model({digest(YOURNAME): ["wrong-title"]})
    runtime.platform_model = platform_model
    byok_model, byok_client = fake_byok_model(vision_model())
    with patched_build(byok_model):
        async with async_client(app) as client:
            response = await client.post(
                "/v1/photo-search", json=body_(YOURNAME), headers=BYOK_HEADERS
            )
    assert response.json()["data"]["results"]["bangumi_id"] == YOURNAME_BANGUMI_ID
    assert platform_calls == []
    byok_client.aclose.assert_awaited_once()


async def test_byok_failure_falls_back_to_platform_and_still_resolves() -> None:
    """Replaces the old canary-miscount test (#656): there is no per-endpoint
    demotion registry anymore, but a BYOK failure must still fall back to
    the platform model for this call and reach the same resolved outcome."""

    def _raise(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        raise RuntimeError("byok endpoint rejected the image")

    app, runtime = app_()
    byok_model, byok_client = fake_byok_model(FunctionModel(_raise))
    with patched_build(byok_model):
        async with async_client(app) as client:
            response = await client.post(
                "/v1/photo-search", json=body_(YOURNAME), headers=BYOK_HEADERS
            )
    assert response.json()["data"]["results"]["bangumi_id"] == YOURNAME_BANGUMI_ID
    byok_client.aclose.assert_awaited_once()
