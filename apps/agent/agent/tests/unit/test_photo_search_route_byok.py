"""BYOK on /v1/photo-search: login gate, fallback, and usage attribution."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from agent.config.settings import Settings
from agent.tests.unit.conftest_fastapi import async_client
from agent.tests.unit.photo_search_route_fixtures import (
    BYOK_HEADERS,
    UsageRepo,
    app_,
    body_,
    down_model,
    fake_byok_model,
    patched_build,
    titles_model,
)


async def test_byok_fallback_is_recorded_as_platform_user_usage() -> None:
    """The BYOK model fails (any I/O-boundary failure); recognition falls
    back to platform, and the usage attribution follows the model that
    actually answered — mirrors the old canary-demotion test's outcome
    without the demotion registry (#656)."""
    app = app_(settings=Settings(model_input_cost_per_mtok_usd=2.0))
    repo = UsageRepo()
    app.state.db_client.usage = repo
    byok_model, fake_client = fake_byok_model(down_model())
    with patched_build(byok_model):
        async with async_client(app) as client:
            response = await client.post(
                "/v1/photo-search", json=body_(), headers=BYOK_HEADERS
            )
    assert response.status_code == 200
    assert [call.scope for call in repo.calls] == ["user"]
    fake_client.aclose.assert_awaited_once()


async def test_byok_success_is_recorded_as_byok_scope_with_zero_platform_cost() -> None:
    app = app_(settings=Settings(model_input_cost_per_mtok_usd=2.0))
    repo = UsageRepo()
    app.state.db_client.usage = repo
    byok_model, fake_client = fake_byok_model(titles_model(["君の名は。"]))
    with patched_build(byok_model):
        async with async_client(app) as client:
            response = await client.post(
                "/v1/photo-search", json=body_(), headers=BYOK_HEADERS
            )
    assert response.status_code == 200
    assert [(call.scope, call.cost_usd) for call in repo.calls] == [("byok", 0.0)]
    fake_client.aclose.assert_awaited_once()


def _unreachable_build() -> object:
    """Patched onto build_byok_model so any accidental call to it fails
    loudly instead of silently constructing a real credential path."""
    return patch(
        "agent.interfaces.routes.photo_search.build_byok_model",
        AsyncMock(side_effect=AssertionError("must not resolve a BYOK model")),
    )


async def test_anonymous_byok_headers_are_rejected_before_any_model_call() -> None:
    anon_headers = {
        "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
        "X-User-Type": "anonymous",
        "X-BYOK-Provider": "anthropic",
        "X-BYOK-Key": "sk-fake-secret-value",
    }
    with _unreachable_build():
        async with async_client(app_()) as client:
            response = await client.post(
                "/v1/photo-search", json=body_(), headers=anon_headers
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
    with _unreachable_build():
        async with async_client(app_()) as client:
            response = await client.post(
                "/v1/photo-search", json=body_(), headers=headers
            )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "byok_requires_login"
