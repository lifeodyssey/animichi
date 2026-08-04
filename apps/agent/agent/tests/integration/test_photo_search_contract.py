"""Integration: /v1/photo-search full pipeline against the named fixtures.

Vision is stubbed at the model layer (`pydantic_ai.models.function.
FunctionModel`, no live provider calls) — everything else — HTTP boundary,
BYOK header parsing, quota, resolve handoff, layer-2 merge — is the real
wiring (issue #260 ACs 4, 6, 9, 10; #656 replaced the old provider-protocol
stub + canary/registry decision tree with the main agent's multimodal input).
"""

from __future__ import annotations

import base64
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from pydantic_ai.messages import (
    BinaryContent,
    ModelMessage,
    ModelResponse,
    ToolCallPart,
    UserPromptPart,
)
from pydantic_ai.models import Model
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.byok_models import ByokModel
from agent.config.settings import Settings
from agent.infrastructure.observability.photo_search import PhotoSearchQuota
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.routes.photo_search import PhotoSearchRuntime
from agent.tests.unit.conftest_fastapi import (
    async_client,
    build_app,
    build_stub_db,
)
from agent.tests.unit.photo_search_fakes import (
    LANDSCAPE_FIXTURE,
    NEARBY_TITLE,
    UNRESOLVABLE_TITLE,
    YOURNAME_BANGUMI_ID,
    YOURNAME_FIXTURE,
    YOURNAME_TITLE,
    FakeCatalog,
    digest,
)

_YOURNAME = YOURNAME_FIXTURE.read_bytes()
_LANDSCAPE = LANDSCAPE_FIXTURE.read_bytes()

BYOK_HEADERS = {
    "X-User-Id": "user-1",
    "X-User-Type": "human",
    "X-BYOK-Provider": "anthropic",
    "X-BYOK-Key": "sk-fake-secret-value",
}


def _sent_images(messages: list[ModelMessage]) -> list[bytes]:
    request = messages[-1]
    images: list[bytes] = []
    for part in request.parts:
        if isinstance(part, UserPromptPart) and isinstance(part.content, list):
            images.extend(
                item.data for item in part.content if isinstance(item, BinaryContent)
            )
    return images


def _keyed_model(mapping: dict[str, list[str]]) -> tuple[Model, list[int]]:
    """A `FunctionModel` mapping exact image bytes to recognised titles —
    stands in for a real vision-capable model without a live API call."""
    calls: list[int] = []

    def fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        calls.append(1)
        images = _sent_images(messages)
        titles = mapping.get(digest(images[0]), []) if images else []
        tool = info.output_tools[0]
        return ModelResponse(
            parts=[ToolCallPart(tool_name=tool.name, args={"candidate_titles": titles})]
        )

    return FunctionModel(fn), calls


def _vision_model() -> Model:
    model, _ = _keyed_model(
        {digest(_YOURNAME): [YOURNAME_TITLE], digest(_LANDSCAPE): []}
    )
    return model


def _app(settings: Settings | None = None) -> tuple[FastAPI, PhotoSearchRuntime]:
    runtime_api = MagicMock(spec=RuntimeAPI)
    runtime_api._db = build_stub_db()
    app, _ = build_app(runtime_api=runtime_api, settings=settings)
    runtime = PhotoSearchRuntime(
        platform_model=_vision_model(),
        catalog=FakeCatalog(),
        quota=PhotoSearchQuota(clock=lambda: datetime(2026, 7, 26, tzinfo=UTC)),
    )
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
    model, _ = _keyed_model({digest(_LANDSCAPE): [UNRESOLVABLE_TITLE]})
    runtime.platform_model = model
    gps = {"lat": 35.2, "lng": 136.2}
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=_body(_LANDSCAPE, gps))
    titles = [c["title"] for c in response.json()["data"]["candidates"]]
    assert titles == [UNRESOLVABLE_TITLE, NEARBY_TITLE]


def _fake_byok_model(model: Model) -> tuple[ByokModel, AsyncMock]:
    fake_client = AsyncMock()
    return ByokModel(model=model, client=fake_client), fake_client


def _patched_build(byok_model: ByokModel) -> object:
    return patch(
        "agent.interfaces.routes.photo_search.build_byok_model",
        AsyncMock(return_value=byok_model),
    )


async def test_byok_answer_resolves_the_pilgrimage_map_without_a_platform_call() -> (
    None
):
    """The BYOK-first contract, end to end: a working BYOK model answers and
    the platform model (which would answer differently) is never touched."""
    app, runtime = _app()
    platform_model, platform_calls = _keyed_model({digest(_YOURNAME): ["wrong-title"]})
    runtime.platform_model = platform_model
    byok_model, byok_client = _fake_byok_model(_vision_model())
    with _patched_build(byok_model):
        async with async_client(app) as client:
            response = await client.post(
                "/v1/photo-search", json=_body(_YOURNAME), headers=BYOK_HEADERS
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

    app, runtime = _app()
    byok_model, byok_client = _fake_byok_model(FunctionModel(_raise))
    with _patched_build(byok_model):
        async with async_client(app) as client:
            response = await client.post(
                "/v1/photo-search", json=_body(_YOURNAME), headers=BYOK_HEADERS
            )
    assert response.json()["data"]["results"]["bangumi_id"] == YOURNAME_BANGUMI_ID
    byok_client.aclose.assert_awaited_once()


async def test_quota_tiers_and_guidance_premises() -> None:
    app, _ = _app(
        settings=Settings(photo_search_quota_anon=1, photo_search_quota_member=0)
    )
    async with async_client(app) as client:
        first = await client.post("/v1/photo-search", json=_body(_YOURNAME))
        second = await client.post("/v1/photo-search", json=_body(_YOURNAME))
        member = await client.post(
            "/v1/photo-search", json=_body(_YOURNAME), headers=BYOK_HEADERS
        )
    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["error"]["details"]["guidance"] == "configure_vision_key"
    assert member.status_code == 429
    assert member.json()["error"]["details"]["guidance"] == "switch_vision_endpoint"
