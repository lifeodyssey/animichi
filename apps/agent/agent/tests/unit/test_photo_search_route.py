"""Unit tests for the /v1/photo-search boundary (validation, quota, confirm).

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
import pytest
from fastapi import FastAPI
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models import Model
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.byok_models import ByokModel
from agent.config.settings import Settings
from agent.infrastructure.observability import photo_search as telemetry
from agent.infrastructure.observability.photo_search import PhotoSearchQuota
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.routes.chat import BUDGET_EXHAUSTED_MESSAGE
from agent.interfaces.routes.photo_search import (
    MAX_IMAGE_BASE64_CHARS,
    PhotoSearchRuntime,
)
from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db
from agent.tests.unit.photo_search_fakes import FakeCatalog

# Valid JPEG magic so the route's strict sniff accepts the stub payload.
_IMAGE = b"\xff\xd8\xff\xe0route-image"

BYOK_HEADERS = {
    "X-User-Id": "user-1",
    "X-User-Type": "human",
    "X-BYOK-Provider": "anthropic",
    "X-BYOK-Key": "sk-fake-secret-value",
}


def _titles_model(titles: list[str]) -> Model:
    def fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        tool = info.output_tools[0]
        return ModelResponse(
            parts=[ToolCallPart(tool_name=tool.name, args={"candidate_titles": titles})]
        )

    return FunctionModel(fn)


def _down_model() -> Model:
    def fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        raise httpx.ConnectError("connection refused")

    return FunctionModel(fn)


def _settings(anon: int | None = None, member: int | None = None) -> Settings:
    return Settings(photo_search_quota_anon=anon, photo_search_quota_member=member)


def _runtime(platform_model: Model) -> PhotoSearchRuntime:
    return PhotoSearchRuntime(
        platform_model=platform_model,
        catalog=FakeCatalog(),
        quota=PhotoSearchQuota(clock=lambda: datetime(2026, 7, 26, tzinfo=UTC)),
    )


def _app(
    settings: Settings | None = None, platform_model: Model | None = None
) -> FastAPI:
    runtime = MagicMock(spec=RuntimeAPI)
    runtime._db = build_stub_db()
    app, _ = build_app(runtime_api=runtime, settings=settings)
    model = (
        platform_model if platform_model is not None else _titles_model(["君の名は。"])
    )
    app.state.photo_search = _runtime(model)
    return app


def _body(mime: str = "image/jpeg", image: bytes = _IMAGE) -> dict[str, object]:
    return {
        "image_base64": base64.b64encode(image).decode("ascii"),
        "mime_type": mime,
    }


def _fake_byok_model(model: Model) -> tuple[ByokModel, AsyncMock]:
    fake_client = AsyncMock(spec=httpx.AsyncClient)
    return ByokModel(model=model, client=fake_client), fake_client


def _patched_build(byok_model: ByokModel) -> object:
    return patch(
        "agent.interfaces.routes.photo_search.build_byok_model",
        AsyncMock(return_value=byok_model),
    )


async def test_photo_search_returns_chat_shaped_search_envelope() -> None:
    async with async_client(_app()) as client:
        response = await client.post("/v1/photo-search", json=_body())
    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "search_bangumi"
    assert payload["success"] is True
    assert payload["data"]["results"]["bangumi_id"] == "160209"


async def test_platform_vision_outage_degrades_to_clarify_not_500() -> None:
    """The fallback/degrade edge must be reachable end-to-end through the route."""
    async with async_client(_app(platform_model=_down_model())) as client:
        response = await client.post("/v1/photo-search", json=_body())
    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "clarify"
    assert payload["data"]["reason"] == "photo_unrecognized"


@dataclass(frozen=True)
class _UsageCall:
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


class _UsageRepo:
    def __init__(self, spent: float = 0.0) -> None:
        self.spent = spent
        self.calls: list[_UsageCall] = []

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
            _UsageCall(
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


async def test_exhausted_anonymous_budget_rejects_before_vision() -> None:
    app = _app(settings=Settings(anon_daily_cost_budget_usd=5.0))
    repo = _UsageRepo(spent=5.0)
    app.state.db_client.usage = repo
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=_body())
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "anon_budget_exhausted"
    assert response.json()["error"]["message"] == BUDGET_EXHAUSTED_MESSAGE
    assert response.json()["error"]["action"] == "login"


async def test_platform_vision_is_recorded_in_the_anonymous_scope() -> None:
    app = _app(settings=Settings(model_input_cost_per_mtok_usd=2.0))
    repo = _UsageRepo()
    app.state.db_client.usage = repo
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=_body())
    assert response.status_code == 200
    assert [(call.scope, call.requests) for call in repo.calls] == [("anon", 1)]


async def test_byok_fallback_is_recorded_as_platform_user_usage() -> None:
    """The BYOK model fails (any I/O-boundary failure); recognition falls
    back to platform, and the usage attribution follows the model that
    actually answered — mirrors the old canary-demotion test's outcome
    without the demotion registry (#656)."""
    app = _app(settings=Settings(model_input_cost_per_mtok_usd=2.0))
    repo = _UsageRepo()
    app.state.db_client.usage = repo
    byok_model, fake_client = _fake_byok_model(_down_model())
    with _patched_build(byok_model):
        async with async_client(app) as client:
            response = await client.post(
                "/v1/photo-search", json=_body(), headers=BYOK_HEADERS
            )
    assert response.status_code == 200
    assert [call.scope for call in repo.calls] == ["user"]
    fake_client.aclose.assert_awaited_once()


async def test_byok_success_is_recorded_as_byok_scope_with_zero_platform_cost() -> None:
    app = _app(settings=Settings(model_input_cost_per_mtok_usd=2.0))
    repo = _UsageRepo()
    app.state.db_client.usage = repo
    byok_model, fake_client = _fake_byok_model(_titles_model(["君の名は。"]))
    with _patched_build(byok_model):
        async with async_client(app) as client:
            response = await client.post(
                "/v1/photo-search", json=_body(), headers=BYOK_HEADERS
            )
    assert response.status_code == 200
    assert [(call.scope, call.cost_usd) for call in repo.calls] == [("byok", 0.0)]
    fake_client.aclose.assert_awaited_once()


async def test_anonymous_byok_headers_are_rejected_before_any_model_call() -> None:
    anon_headers = {
        "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
        "X-User-Type": "anonymous",
        "X-BYOK-Provider": "anthropic",
        "X-BYOK-Key": "sk-fake-secret-value",
    }
    with patch(
        "agent.interfaces.routes.photo_search.build_byok_model",
        AsyncMock(side_effect=AssertionError("must not resolve a BYOK model")),
    ):
        async with async_client(_app()) as client:
            response = await client.post(
                "/v1/photo-search", json=_body(), headers=anon_headers
            )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "byok_requires_login"


@pytest.mark.parametrize(
    "user_type_header",
    [{}, {"X-User-Type": "human_typo"}],
    ids=["missing_user_type", "wrong_user_type_value"],
)
async def test_anon_id_prefix_gates_byok_even_without_the_literal_anonymous_type(
    user_type_header: dict[str, str],
) -> None:
    """Regression (coordinator review, #739): the login gate must use the
    same `is_anonymous_identity` predicate quota metering already trusts.
    An `anon_`-prefixed X-User-Id with a missing or mistyped X-User-Type is
    anonymous by that convention even though it never equals the literal
    string "anonymous" — a caller shaped exactly like this cleared the old
    gate (200, real BYOK model resolution attempted) and only the quota/
    usage-scope logic downstream classified them as anonymous."""
    headers = {
        "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
        "X-BYOK-Provider": "anthropic",
        "X-BYOK-Key": "sk-fake-secret-value",
        **user_type_header,
    }
    with patch(
        "agent.interfaces.routes.photo_search.build_byok_model",
        AsyncMock(side_effect=AssertionError("must not resolve a BYOK model")),
    ):
        async with async_client(_app()) as client:
            response = await client.post(
                "/v1/photo-search", json=_body(), headers=headers
            )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "byok_requires_login"


async def test_unsupported_mime_type_is_a_clear_415() -> None:
    async with async_client(_app()) as client:
        response = await client.post("/v1/photo-search", json=_body(mime="image/gif"))
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_image_format"


async def test_undecodable_image_is_a_422() -> None:
    body = {"image_base64": "?not-base64?", "mime_type": "image/jpeg"}
    async with async_client(_app()) as client:
        response = await client.post("/v1/photo-search", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_image"


async def test_labelled_jpeg_with_non_image_bytes_is_a_415() -> None:
    async with async_client(_app()) as client:
        response = await client.post(
            "/v1/photo-search", json=_body(image=b"not-an-image")
        )
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_image_format"


async def test_oversized_image_is_a_typed_413() -> None:
    body = {
        "image_base64": "A" * (MAX_IMAGE_BASE64_CHARS + 4),
        "mime_type": "image/jpeg",
    }
    async with async_client(_app()) as client:
        response = await client.post("/v1/photo-search", json=body)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "image_too_large"


async def test_quota_key_ignores_client_controlled_session_header() -> None:
    app = _app(settings=_settings(anon=1))
    async with async_client(app) as client:
        first = await client.post(
            "/v1/photo-search", json=_body(), headers={"x-session-id": "s-1"}
        )
        second = await client.post(
            "/v1/photo-search", json=_body(), headers={"x-session-id": "s-2"}
        )
    assert first.status_code == 200
    assert (
        second.status_code == 429
    )  # rotating the session header must not reset the meter


async def test_anon_quota_exhaustion_guides_toward_configuring_a_key() -> None:
    app = _app(settings=_settings(anon=1))
    async with async_client(app) as client:
        first = await client.post("/v1/photo-search", json=_body())
        second = await client.post("/v1/photo-search", json=_body())
    assert first.status_code == 200
    assert second.status_code == 429
    error = second.json()["error"]
    assert error["code"] == "photo_search_quota_exhausted"
    assert error["details"]["guidance"] == "configure_vision_key"


async def test_byok_present_but_quota_exhausted_guides_toward_switching_endpoint() -> (
    None
):
    app = _app(settings=_settings(member=0))
    async with async_client(app) as client:
        response = await client.post(
            "/v1/photo-search", json=_body(), headers=BYOK_HEADERS
        )
    assert response.status_code == 429
    assert response.json()["error"]["details"]["guidance"] == "switch_vision_endpoint"


async def test_member_and_anon_quotas_are_separate_tiers() -> None:
    app = _app(settings=_settings(anon=0, member=1))
    async with async_client(app) as client:
        anon = await client.post("/v1/photo-search", json=_body())
        member = await client.post(
            "/v1/photo-search", json=_body(), headers={"X-User-Id": "user-1"}
        )
    assert anon.status_code == 429
    assert member.status_code == 200


async def test_confirm_records_user_confirmed_signal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    counter = MagicMock()
    monkeypatch.setattr(telemetry, "_photo_searches", counter)
    body = {
        "query_type": "anime_screenshot",
        "gps_available": False,
        "layer_hit": "1",
        "candidates_shown": 2,
    }
    async with async_client(_app()) as client:
        response = await client.post("/v1/photo-search/confirm", json=body)
    assert response.status_code == 204
    attributes = counter.add.call_args.args[1]
    assert attributes["user_confirmed"] is True
    assert attributes["candidates_shown"] == 2


async def test_confirm_rejects_the_vision_unavailable_alert_signal() -> None:
    """#502 review round 2: the anonymous-reachable confirm endpoint must not
    be able to inject events into the "vision unavailable" ops-alert bucket
    — that value is server-derived only, never a real confirm outcome."""
    body = {
        "query_type": "vision_unavailable",
        "gps_available": False,
        "layer_hit": "none",
        "candidates_shown": 0,
    }
    async with async_client(_app()) as client:
        response = await client.post("/v1/photo-search/confirm", json=body)
    assert response.status_code == 422


async def test_identified_caller_without_user_type_is_not_metered_as_anonymous() -> (
    None
):
    """`X-User-Id` with no `X-User-Type` is identified, not anonymous.

    The edge sets both headers together, so this is defence in depth. It is
    pinned because the failure is silent: the caller's spend lands in the anon
    scope and, once the anon budget is exhausted, they are refused with a
    login prompt they cannot act on.
    """
    app = _app(settings=Settings(anon_daily_cost_budget_usd=5.0))
    repo = _UsageRepo(spent=5.0)
    app.state.db_client.usage = repo
    async with async_client(app) as client:
        response = await client.post(
            "/v1/photo-search", json=_body(), headers={"X-User-Id": "user-1"}
        )
    assert response.status_code == 200
    assert [call.scope for call in repo.calls] == ["user"]
