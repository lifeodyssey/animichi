"""Slim /v1/photo-search transport tests (AGENT-1 #952).

The route only parses the generated DTOs, runs admission, and maps the use
case results — the behavior behind each of these statuses is proven at the
application seam (`test_search_photo.py`, `test_confirm_photo_offer.py`).
These tests pin the wire envelope, the offer id, and the typed errors.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from animichi.infrastructure.observability import photo_search as telemetry
from animichi.tests.unit.conftest_fastapi import async_client
from animichi.tests.unit.photo_search_route_fixtures import (
    app_,
    body_,
    confirm_body,
    down_model,
    post_photo_search_confirm,
)

_ANON_BYOK_COMMON = {
    "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
    "X-BYOK-Provider": "anthropic",
    "X-BYOK-Key": "sk-fake-secret-value",
}


async def _search_and_offer_id(client) -> str:
    response = await client.post("/v1/photo-search", json=body_())
    assert response.status_code == 200
    return response.json()["offer_id"]


async def test_photo_search_returns_the_generated_envelope_with_an_offer_id() -> None:
    async with async_client(app_()) as client:
        response = await client.post("/v1/photo-search", json=body_())
    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "search_bangumi"
    assert payload["success"] is True
    assert payload["offer_id"] != ""
    assert payload["data"]["results"]["bangumi_id"] == "160209"


async def test_platform_vision_outage_degrades_to_clarify_not_500() -> None:
    """The fallback/degrade edge must be reachable end-to-end through the route."""
    async with async_client(app_(platform_model=down_model())) as client:
        response = await client.post("/v1/photo-search", json=body_())
    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "clarify"
    assert payload["data"]["reason"] == "photo_unrecognized"


async def test_unsupported_mime_is_a_typed_415() -> None:
    async with async_client(app_()) as client:
        mime = await client.post("/v1/photo-search", json=body_(mime="image/gif"))
    assert mime.status_code == 415
    assert mime.json()["error"]["code"] == "unsupported_image_format"


async def test_confirm_records_user_confirmed_with_offer_derived_signals(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    counter = MagicMock()
    monkeypatch.setattr(telemetry, "_photo_searches", counter)
    app = app_()
    async with async_client(app) as client:
        offer_id = await _search_and_offer_id(client)
    response = await post_photo_search_confirm(
        app, body=confirm_body(offer_id=offer_id, candidate_id="p1")
    )
    assert response.status_code == 204
    attributes = counter.add.call_args.args[1]
    assert attributes["user_confirmed"] is True
    assert attributes["candidates_shown"] == 1


async def test_confirm_of_an_unknown_offer_is_a_404() -> None:
    response = await post_photo_search_confirm(
        app_(), body=confirm_body(offer_id="no-such-offer")
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "photo_offer_not_found"


async def test_confirm_with_a_session_shaped_offer_id_fails() -> None:
    """TURN-4 separation: a Session identifier is never a photo offer id."""
    response = await post_photo_search_confirm(
        app_(), body=confirm_body(offer_id="sess-1")
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "photo_offer_not_found"


async def test_anonymous_byok_headers_are_rejected_before_any_model_call() -> None:
    headers = {**_ANON_BYOK_COMMON, "X-User-Type": "anonymous"}
    async with async_client(app_()) as client:
        response = await client.post("/v1/photo-search", json=body_(), headers=headers)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "byok_requires_login"


async def test_quota_key_ignores_the_client_controlled_session_header() -> None:
    from animichi.config.settings import Settings

    app = app_(settings=Settings(photo_search_quota_anon=1))
    async with async_client(app) as client:
        first = await client.post(
            "/v1/photo-search", json=body_(), headers={"x-session-id": "s-1"}
        )
        second = await client.post(
            "/v1/photo-search", json=body_(), headers={"x-session-id": "s-2"}
        )
    assert first.status_code == 200
    # rotating the session header must not reset the meter
    assert second.status_code == 429


async def test_exhausted_anonymous_budget_rejects_before_vision() -> None:
    from animichi.config.settings import Settings
    from animichi.interfaces.routes.admission import BUDGET_EXHAUSTED_MESSAGE
    from animichi.tests.unit.photo_search_route_fixtures import UsageRepo

    app = app_(settings=Settings(anon_daily_cost_budget_usd=5.0))
    app.state.db_client.usage = UsageRepo(spent=5.0)
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=body_())
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "anon_budget_exhausted"
    assert response.json()["error"]["message"] == BUDGET_EXHAUSTED_MESSAGE
    assert response.json()["error"]["action"] == "login"
