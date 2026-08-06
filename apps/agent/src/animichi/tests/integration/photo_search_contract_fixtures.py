"""Shared fixtures for the /v1/photo-search integration contract tests.

Not a test module itself — split out so `test_photo_search_contract*.py`
can each stay under the repo's 200-line test file budget.

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

from animichi.agents.byok_models import ByokModel
from animichi.config.settings import Settings
from animichi.infrastructure.observability.photo_search import PhotoSearchQuota
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.routes.photo_search import PhotoSearchRuntime
from animichi.tests.unit.conftest_fastapi import build_app, build_stub_db
from animichi.tests.unit.photo_search_fakes import (
    LANDSCAPE_FIXTURE,
    YOURNAME_FIXTURE,
    YOURNAME_TITLE,
    FakeCatalog,
    digest,
)

YOURNAME = YOURNAME_FIXTURE.read_bytes()
LANDSCAPE = LANDSCAPE_FIXTURE.read_bytes()

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


def keyed_model(mapping: dict[str, list[str]]) -> tuple[Model, list[int]]:
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


def vision_model() -> Model:
    model, _ = keyed_model({digest(YOURNAME): [YOURNAME_TITLE], digest(LANDSCAPE): []})
    return model


def app_(settings: Settings | None = None) -> tuple[FastAPI, PhotoSearchRuntime]:
    runtime_api = MagicMock(spec=RuntimeAPI)
    runtime_api._db = build_stub_db()
    app, _ = build_app(runtime_api=runtime_api, settings=settings)
    runtime = PhotoSearchRuntime(
        platform_model=vision_model(),
        catalog=FakeCatalog(),
        quota=PhotoSearchQuota(clock=lambda: datetime(2026, 7, 26, tzinfo=UTC)),
    )
    app.state.photo_search = runtime
    return app, runtime


def body_(image: bytes, gps: dict[str, float] | None = None) -> dict[str, object]:
    body: dict[str, object] = {
        "image_base64": base64.b64encode(image).decode("ascii"),
        "mime_type": "image/jpeg",
    }
    if gps is not None:
        body["gps"] = gps
    return body


def fake_byok_model(model: Model) -> tuple[ByokModel, AsyncMock]:
    fake_client = AsyncMock()
    return ByokModel(model=model, client=fake_client), fake_client


def patched_build(byok_model: ByokModel) -> object:
    return patch(
        "animichi.interfaces.routes.photo_search.build_byok_model",
        AsyncMock(return_value=byok_model),
    )
