"""Budget/quota on /v1/photo-search: the anon cost breaker, the per-day
photo-search counter, usage-scope attribution, and the ordering between
rejecting guards and quota consumption.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx

from agent.agents.byok_models import ByokModel
from agent.config.settings import Settings
from agent.interfaces.routes.chat import BUDGET_EXHAUSTED_MESSAGE
from agent.tests.unit.conftest_fastapi import async_client
from agent.tests.unit.photo_search_route_fixtures import (
    BYOK_HEADERS,
    UsageRepo,
    app_,
    body_,
    settings_,
    titles_model,
)


async def test_exhausted_anonymous_budget_rejects_before_vision() -> None:
    app = app_(settings=Settings(anon_daily_cost_budget_usd=5.0))
    repo = UsageRepo(spent=5.0)
    app.state.db_client.usage = repo
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=body_())
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "anon_budget_exhausted"
    assert response.json()["error"]["message"] == BUDGET_EXHAUSTED_MESSAGE
    assert response.json()["error"]["action"] == "login"


async def test_platform_vision_is_recorded_in_the_anonymous_scope() -> None:
    app = app_(settings=Settings(model_input_cost_per_mtok_usd=2.0))
    repo = UsageRepo()
    app.state.db_client.usage = repo
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=body_())
    assert response.status_code == 200
    assert [(call.scope, call.requests) for call in repo.calls] == [("anon", 1)]


async def test_identified_caller_without_user_type_is_not_metered_as_anonymous() -> (
    None
):
    """`X-User-Id` with no `X-User-Type` is identified, not anonymous.

    The edge sets both headers together, so this is defence in depth. It is
    pinned because the failure is silent: the caller's spend lands in the anon
    scope and, once the anon budget is exhausted, they are refused with a
    login prompt they cannot act on.
    """
    app = app_(settings=Settings(anon_daily_cost_budget_usd=5.0))
    repo = UsageRepo(spent=5.0)
    app.state.db_client.usage = repo
    async with async_client(app) as client:
        response = await client.post(
            "/v1/photo-search", json=body_(), headers={"X-User-Id": "user-1"}
        )
    assert response.status_code == 200
    assert [call.scope for call in repo.calls] == ["user"]


async def test_quota_key_ignores_client_controlled_session_header() -> None:
    app = app_(settings=settings_(anon=1))
    async with async_client(app) as client:
        first = await client.post(
            "/v1/photo-search", json=body_(), headers={"x-session-id": "s-1"}
        )
        second = await client.post(
            "/v1/photo-search", json=body_(), headers={"x-session-id": "s-2"}
        )
    assert first.status_code == 200
    assert (
        second.status_code == 429
    )  # rotating the session header must not reset the meter


async def test_anon_quota_exhaustion_guides_toward_configuring_a_key() -> None:
    app = app_(settings=settings_(anon=1))
    async with async_client(app) as client:
        first = await client.post("/v1/photo-search", json=body_())
        second = await client.post("/v1/photo-search", json=body_())
    assert first.status_code == 200
    assert second.status_code == 429
    error = second.json()["error"]
    assert error["code"] == "photo_search_quota_exhausted"
    assert error["details"]["guidance"] == "configure_vision_key"


async def test_byok_present_but_quota_exhausted_guides_toward_switching_endpoint() -> (
    None
):
    app = app_(settings=settings_(member=0))
    async with async_client(app) as client:
        response = await client.post(
            "/v1/photo-search", json=body_(), headers=BYOK_HEADERS
        )
    assert response.status_code == 429
    assert response.json()["error"]["details"]["guidance"] == "switch_vision_endpoint"


async def test_member_and_anon_quotas_are_separate_tiers() -> None:
    app = app_(settings=settings_(anon=0, member=1))
    async with async_client(app) as client:
        anon = await client.post("/v1/photo-search", json=body_())
        member = await client.post(
            "/v1/photo-search", json=body_(), headers={"X-User-Id": "user-1"}
        )
    assert anon.status_code == 429
    assert member.status_code == 200


_MALFORMED_OPENAI_COMPAT_BYOK = {
    "X-User-Id": "user-1",
    "X-User-Type": "human",
    "X-BYOK-Provider": "openai-compatible",
    "X-BYOK-Key": "sk-fake-secret-value",
    "X-BYOK-Base-Url": "https://byok.example.test/v1",
    # X-BYOK-Model deliberately omitted: required for this family, so
    # _resolve_byok_model rejects with 400 invalid_request before recognition
    # (and, this test's point, before quota is ever touched).
}


async def test_a_rejected_byok_resolution_never_spends_the_quota_slot() -> None:
    """Coordinator review (#739, CodeRabbit finding 1): quota used to be
    consumed before BYOK resolution could reject the turn, so a request that
    got nothing still cost the caller a slot from their daily allowance.
    `_prepare_turn` now resolves BYOK (a rejecting guard) before consuming
    quota — proven here by a same-tier follow-up request still succeeding."""
    app = app_(settings=settings_(member=1))
    async with async_client(app) as client:
        rejected = await client.post(
            "/v1/photo-search", json=body_(), headers=_MALFORMED_OPENAI_COMPAT_BYOK
        )
        assert rejected.status_code == 400
        assert rejected.json()["error"]["code"] == "invalid_request"
        following = await client.post(
            "/v1/photo-search",
            json=body_(),
            headers={"X-User-Id": "user-1", "X-User-Type": "human"},
        )
    assert following.status_code == 200


async def test_quota_rejection_after_byok_resolves_still_closes_its_client() -> None:
    """The other half of the reordering: when BYOK resolves fine but the
    quota check rejects afterward, the already-open BYOK client must not
    leak — `_prepare_turn` closes it on that path too."""
    app = app_(settings=settings_(member=0))
    fake_client = AsyncMock(spec=httpx.AsyncClient)
    byok_model = ByokModel(model=titles_model(["君の名は。"]), client=fake_client)
    with patch(
        "agent.interfaces.routes.photo_search.build_byok_model",
        AsyncMock(return_value=byok_model),
    ):
        async with async_client(app) as client:
            response = await client.post(
                "/v1/photo-search", json=body_(), headers=BYOK_HEADERS
            )
    assert response.status_code == 429
    fake_client.aclose.assert_awaited_once()
