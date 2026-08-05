"""Image validation on /v1/photo-search: mime, decode, and size limits."""

from __future__ import annotations

from animichi.interfaces.routes.photo_search import MAX_IMAGE_BASE64_CHARS
from animichi.tests.unit.conftest_fastapi import async_client
from animichi.tests.unit.photo_search_route_fixtures import app_, body_


async def test_unsupported_mime_type_is_a_clear_415() -> None:
    async with async_client(app_()) as client:
        response = await client.post("/v1/photo-search", json=body_(mime="image/gif"))
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_image_format"


async def test_undecodable_image_is_a_422() -> None:
    body = {"image_base64": "?not-base64?", "mime_type": "image/jpeg"}
    async with async_client(app_()) as client:
        response = await client.post("/v1/photo-search", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_image"


async def test_labelled_jpeg_with_non_image_bytes_is_a_415() -> None:
    async with async_client(app_()) as client:
        response = await client.post(
            "/v1/photo-search", json=body_(image=b"not-an-image")
        )
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_image_format"


async def test_oversized_image_is_a_typed_413() -> None:
    body = {
        "image_base64": "A" * (MAX_IMAGE_BASE64_CHARS + 4),
        "mime_type": "image/jpeg",
    }
    async with async_client(app_()) as client:
        response = await client.post("/v1/photo-search", json=body)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "image_too_large"
