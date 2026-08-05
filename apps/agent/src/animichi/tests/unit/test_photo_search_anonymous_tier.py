"""Regression coverage for anonymous photo-search tier selection (#534)."""

from animichi.tests.unit.conftest_fastapi import async_client
from animichi.tests.unit.photo_search_route_fixtures import app_, body_, settings_

_ANON_USER_ID = "anon_0123456789abcdef0123456789abcdef"


async def test_typed_anonymous_identity_consumes_the_anonymous_quota() -> None:
    app = app_(settings=settings_(anon=0, member=1))
    headers = {"X-User-Id": _ANON_USER_ID, "X-User-Type": "anonymous"}
    async with async_client(app) as client:
        response = await client.post("/v1/photo-search", json=body_(), headers=headers)
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "photo_search_quota_exhausted"


async def test_anonymous_id_prefix_consumes_the_anonymous_quota() -> None:
    app = app_(settings=settings_(anon=0, member=1))
    async with async_client(app) as client:
        response = await client.post(
            "/v1/photo-search",
            json=body_(),
            headers={"X-User-Id": _ANON_USER_ID},
        )
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "photo_search_quota_exhausted"
