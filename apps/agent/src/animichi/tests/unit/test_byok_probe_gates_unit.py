"""Unit coverage for the BYOK probe login gate and response mapping."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import FastAPI

from animichi.interfaces.boundary.agent_models import ByokProbeResponse
from animichi.interfaces.services.byok_probe import ProbeModelCredential, ProbeRejection
from animichi.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db

pytestmark = pytest.mark.unit

ANON_HEADERS = {
    "X-User-Id": "anon_0123456789abcdef0123456789abcdef",
    "X-User-Type": "anonymous",
}
HUMAN_HEADERS = {"X-User-Id": "user-1", "X-User-Type": "human"}
BYOK_HEADERS = {
    "X-BYOK-Provider": "openai-compatible",
    "X-BYOK-Key": "sk-fake-secret-value",
    "X-BYOK-Model": "byok-test-model",
    "X-BYOK-Base-Url": "https://byok.example.test/v1",
}


def _probe_app() -> FastAPI:
    app, _ = build_app(db=build_stub_db())
    return app


async def test_probe_gate_allows_a_logged_in_caller_through(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MIMO_API_KEY", "test-key")
    async with async_client(_probe_app()) as client:
        response = await client.post("/v1/byok/probe", json={}, headers=HUMAN_HEADERS)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


async def test_probe_gate_rejects_when_anonymous_and_byok_both_true() -> None:
    async with async_client(_probe_app()) as client:
        response = await client.post(
            "/v1/byok/probe", json={}, headers=ANON_HEADERS | BYOK_HEADERS
        )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "byok_requires_login"


async def test_probe_gate_route_never_constructs_a_model_for_the_rejected_caller() -> (
    None
):
    with patch(
        "animichi.interfaces.services.byok_probe.build_byok_model",
        AsyncMock(side_effect=AssertionError("must not resolve a BYOK model")),
    ):
        async with async_client(_probe_app()) as client:
            response: httpx.Response = await client.post(
                "/v1/byok/probe", json={}, headers=ANON_HEADERS | BYOK_HEADERS
            )
    assert response.status_code == 403


async def test_probe_success_maps_the_capability_response() -> None:
    credential = SimpleNamespace(
        probe=AsyncMock(
            return_value=ByokProbeResponse(vision=True, reachable=True, error_code=None)
        )
    )
    with patch("animichi.interfaces.routes.byok._probe_model_credential", credential):
        async with async_client(_probe_app()) as client:
            response = await client.post(
                "/v1/byok/probe", json={}, headers=HUMAN_HEADERS | BYOK_HEADERS
            )
    assert response.status_code == 200
    assert response.json() == {"vision": True, "reachable": True, "error_code": None}


async def test_probe_maps_a_capability_rejection_to_its_code() -> None:
    rejection = ProbeRejection("egress_blocked", "base_url failed egress validation.")
    credential = SimpleNamespace(probe=AsyncMock(side_effect=rejection))
    with patch("animichi.interfaces.routes.byok._probe_model_credential", credential):
        async with async_client(_probe_app()) as client:
            response = await client.post(
                "/v1/byok/probe", json={}, headers=HUMAN_HEADERS | BYOK_HEADERS
            )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "egress_blocked"


async def test_probe_route_success_maps_to_the_generated_boundary() -> None:
    response_model = ByokProbeResponse(vision=True, reachable=True, error_code=None)
    with patch.object(
        ProbeModelCredential, "probe", AsyncMock(return_value=response_model)
    ):
        async with async_client(_probe_app()) as client:
            response = await client.post(
                "/v1/byok/probe", json={}, headers=HUMAN_HEADERS | BYOK_HEADERS
            )
    assert response.status_code == 200
    assert response.json() == {"vision": True, "reachable": True, "error_code": None}


async def test_probe_route_maps_rejection_to_the_stable_envelope() -> None:
    rejection = ProbeRejection("egress_blocked", "egress blocked")
    with patch.object(ProbeModelCredential, "probe", AsyncMock(side_effect=rejection)):
        async with async_client(_probe_app()) as client:
            response = await client.post(
                "/v1/byok/probe", json={}, headers=HUMAN_HEADERS | BYOK_HEADERS
            )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "egress_blocked"
