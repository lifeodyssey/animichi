"""Shared fixtures for the /v1/photo-search route test files.

Not a test module itself (no `test_*` functions) — split out so
`test_photo_search_route*.py` can each stay under the repo's 200-line test
file budget and topic-anonymous_tier tests
(`test_photo_search_anonymous_tier.py`) have one canonical place to import
`_app`/`_body`/`_settings` from.

BYOK model resolution is patched at `agent.interfaces.routes.photo_search.
build_byok_model` — the same pattern `test_byok_chat_routing.py` uses for
`/v1/chat` — so these tests exercise the route's own wiring (header parsing,
quota, usage attribution) without needing a real provider credential.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from fastapi import FastAPI
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models import Model
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.byok_models import ByokModel
from agent.config.settings import Settings
from agent.infrastructure.observability.photo_search import PhotoSearchQuota
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.routes.photo_search import PhotoSearchRuntime
from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db
from agent.tests.unit.photo_search_fakes import FakeCatalog

# Valid JPEG magic so the route's strict sniff accepts the stub payload.
IMAGE = b"\xff\xd8\xff\xe0route-image"

BYOK_HEADERS = {
    "X-User-Id": "user-1",
    "X-User-Type": "human",
    "X-BYOK-Provider": "anthropic",
    "X-BYOK-Key": "sk-fake-secret-value",
}


def titles_model(titles: list[str]) -> Model:
    def fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        tool = info.output_tools[0]
        return ModelResponse(
            parts=[ToolCallPart(tool_name=tool.name, args={"candidate_titles": titles})]
        )

    return FunctionModel(fn)


def down_model() -> Model:
    def fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        raise httpx.ConnectError("connection refused")

    return FunctionModel(fn)


def settings_(anon: int | None = None, member: int | None = None) -> Settings:
    return Settings(photo_search_quota_anon=anon, photo_search_quota_member=member)


def _runtime(platform_model: Model) -> PhotoSearchRuntime:
    return PhotoSearchRuntime(
        platform_model=platform_model,
        catalog=FakeCatalog(),
        quota=PhotoSearchQuota(clock=lambda: datetime(2026, 7, 26, tzinfo=UTC)),
    )


def app_(
    settings: Settings | None = None, platform_model: Model | None = None
) -> FastAPI:
    runtime = MagicMock(spec=RuntimeAPI)
    runtime._db = build_stub_db()
    app, _ = build_app(runtime_api=runtime, settings=settings)
    model = (
        platform_model if platform_model is not None else titles_model(["君の名は。"])
    )
    app.state.photo_search = _runtime(model)
    return app


def body_(mime: str = "image/jpeg", image: bytes = IMAGE) -> dict[str, object]:
    return {
        "image_base64": base64.b64encode(image).decode("ascii"),
        "mime_type": mime,
    }


async def post_photo_search(
    app: FastAPI, *, headers: dict[str, str] | None = None
) -> httpx.Response:
    """POST /v1/photo-search with the standard stub body and optional headers."""
    async with async_client(app) as client:
        return await client.post("/v1/photo-search", json=body_(), headers=headers)


async def post_photo_search_confirm(
    app: FastAPI, *, body: dict[str, object]
) -> httpx.Response:
    """POST /v1/photo-search/confirm with an explicit body."""
    async with async_client(app) as client:
        return await client.post("/v1/photo-search/confirm", json=body)


def confirm_body(
    *, query_type: str, layer_hit: str, candidates_shown: int
) -> dict[str, object]:
    """The /v1/photo-search/confirm body; gps_available is always false here."""
    return {
        "query_type": query_type,
        "gps_available": False,
        "layer_hit": layer_hit,
        "candidates_shown": candidates_shown,
    }


def fake_byok_model(model: Model) -> tuple[ByokModel, AsyncMock]:
    fake_client = AsyncMock(spec=httpx.AsyncClient)
    return ByokModel(model=model, client=fake_client), fake_client


def patched_build(byok_model: ByokModel) -> object:
    return patch(
        "agent.interfaces.routes.photo_search.build_byok_model",
        AsyncMock(return_value=byok_model),
    )


@dataclass(frozen=True)
class UsageCall:
    """One `accumulate_usage` invocation, mirroring the port signature exactly.

    Typed rather than a `dict[str, object]` bag so the fake enforces the port
    contract: `**kwargs: object` would swallow a misspelled or dropped keyword
    argument and the test would still pass.
    """

    usage_date: date
    scope: str
    requests: int
    input_tokens: int
    output_tokens: int
    cost_usd: float


class UsageRepo:
    def __init__(self, spent: float = 0.0) -> None:
        self.spent = spent
        self.calls: list[UsageCall] = []

    async def accumulate_usage(
        self,
        *,
        usage_date: date,
        scope: str,
        requests: int,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> None:
        self.calls.append(
            UsageCall(
                usage_date=usage_date,
                scope=scope,
                requests=requests,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_usd=cost_usd,
            )
        )

    async def total_cost_usd(self, *, usage_date: date, scope: str) -> float:
        del usage_date, scope
        return self.spent
