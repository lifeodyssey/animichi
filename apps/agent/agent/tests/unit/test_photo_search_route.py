"""Unit tests for the /v1/photo-search boundary (validation, quota, confirm)."""

from __future__ import annotations

import base64
from datetime import UTC, datetime
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi import FastAPI

from agent.agents.vision_supply_router import VisionRecognition
from agent.config.settings import Settings
from agent.infrastructure.observability import photo_search as telemetry
from agent.infrastructure.observability.photo_search import PhotoSearchQuota
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.routes.photo_search import (
    MAX_IMAGE_BASE64_CHARS,
    PhotoSearchRuntime,
)
from agent.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db
from agent.tests.unit.photo_search_fakes import (
    YOURNAME_TITLE,
    FakeCatalog,
    KeyedVisionStub,
    digest,
)

# Valid JPEG magic so the route's strict sniff accepts the stub payload.
_IMAGE = b"\xff\xd8\xff\xe0route-image"


def _settings(anon: int | None = None, member: int | None = None) -> Settings:
    return Settings(photo_search_quota_anon=anon, photo_search_quota_member=member)


def _app(settings: Settings | None = None) -> FastAPI:
    runtime = MagicMock(spec=RuntimeAPI)
    runtime._db = build_stub_db()
    app, _ = build_app(runtime_api=runtime, settings=settings)
    stub = KeyedVisionStub({digest(_IMAGE): [YOURNAME_TITLE]})
    app.state.photo_search = PhotoSearchRuntime(
        platform_provider=stub,
        catalog=FakeCatalog(),
        quota=PhotoSearchQuota(clock=lambda: datetime(2026, 7, 26, tzinfo=UTC)),
    )
    return app


def _body(mime: str = "image/jpeg", image: bytes = _IMAGE) -> dict[str, object]:
    return {
        "image_base64": base64.b64encode(image).decode("ascii"),
        "mime_type": mime,
    }


async def test_photo_search_returns_chat_shaped_search_envelope() -> None:
    async with async_client(_app()) as client:
        response = await client.post("/v1/photo-search", json=_body())
    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "search_bangumi"
    assert payload["success"] is True
    assert payload["data"]["results"]["bangumi_id"] == "160209"


class _DownVisionProvider:
    """#502: the platform vision call raises instead of answering."""

    async def recognize(self, images: list[bytes], locale: str) -> VisionRecognition:
        raise httpx.ConnectError("connection refused")


def _outage_app() -> FastAPI:
    app = _app()
    app.state.photo_search = PhotoSearchRuntime(
        platform_provider=_DownVisionProvider(),
        catalog=FakeCatalog(),
        quota=PhotoSearchQuota(clock=lambda: datetime(2026, 7, 26, tzinfo=UTC)),
    )
    return app


def _assert_clarify_response(response: httpx.Response) -> None:
    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "clarify"
    assert payload["data"]["reason"] == "photo_unrecognized"


async def test_platform_vision_outage_degrades_to_clarify_not_500() -> None:
    """The fallback/degrade edge must be reachable end-to-end through the route."""
    async with async_client(_outage_app()) as client:
        response = await client.post("/v1/photo-search", json=_body())
    _assert_clarify_response(response)


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


async def test_byok_without_vision_guides_toward_switching_endpoint() -> None:
    app = _app(settings=_settings(member=0))
    headers = {"X-User-Id": "user-1", "x-byok-endpoint": "ep-1"}
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=_body(), headers=headers)
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
