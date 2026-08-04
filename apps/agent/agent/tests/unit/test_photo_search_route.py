"""Core /v1/photo-search route contract: happy path, outage degrade, confirm.

Validation (415/422/413), BYOK, and quota/budget topics live in their own
`test_photo_search_route_*.py` files — see `photo_search_route_fixtures.py`
for the shared `app_`/`body_`/`settings_` builders.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from agent.infrastructure.observability import photo_search as telemetry
from agent.tests.unit.conftest_fastapi import async_client
from agent.tests.unit.photo_search_route_fixtures import (
    app_,
    body_,
    confirm_body,
    down_model,
    post_photo_search_confirm,
)


async def test_photo_search_returns_chat_shaped_search_envelope() -> None:
    async with async_client(app_()) as client:
        response = await client.post("/v1/photo-search", json=body_())
    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "search_bangumi"
    assert payload["success"] is True
    assert payload["data"]["results"]["bangumi_id"] == "160209"


async def test_platform_vision_outage_degrades_to_clarify_not_500() -> None:
    """The fallback/degrade edge must be reachable end-to-end through the route."""
    async with async_client(app_(platform_model=down_model())) as client:
        response = await client.post("/v1/photo-search", json=body_())
    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "clarify"
    assert payload["data"]["reason"] == "photo_unrecognized"


async def test_confirm_records_user_confirmed_signal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    counter = MagicMock()
    monkeypatch.setattr(telemetry, "_photo_searches", counter)
    body = confirm_body(
        query_type="anime_screenshot", layer_hit="1", candidates_shown=2
    )
    response = await post_photo_search_confirm(app_(), body=body)
    assert response.status_code == 204
    attributes = counter.add.call_args.args[1]
    assert attributes["user_confirmed"] is True
    assert attributes["candidates_shown"] == 2


async def test_confirm_rejects_the_vision_unavailable_alert_signal() -> None:
    """#502 review round 2: the anonymous-reachable confirm endpoint must not
    be able to inject events into the "vision unavailable" ops-alert bucket
    — that value is server-derived only, never a real confirm outcome."""
    body = confirm_body(
        query_type="vision_unavailable", layer_hit="none", candidates_shown=0
    )
    response = await post_photo_search_confirm(app_(), body=body)
    assert response.status_code == 422
