"""HTTP status pins for typed runtime terminals."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from agent.infrastructure.session.memory import InMemorySessionStore
from agent.interfaces.public_api import RuntimeAPI, _invalid_selection_response
from agent.interfaces.schemas import PublicAPIResponse
from agent.tests.unit.conftest_fastapi import (
    async_client,
    build_app,
    build_stub_db,
)


def _runtime(response: PublicAPIResponse) -> MagicMock:
    runtime = MagicMock(spec=RuntimeAPI)
    runtime.handle = AsyncMock(return_value=response)
    runtime._db = build_stub_db()
    runtime._session_store = InMemorySessionStore()
    return runtime


async def _post(response: PublicAPIResponse) -> httpx.Response:
    app, _ = build_app(runtime_api=_runtime(response))
    async with async_client(app) as client:
        return await client.post("/v1/runtime", json={"text": "test"})


def _terminal(status: str, intent: str) -> PublicAPIResponse:
    return PublicAPIResponse(
        success=False, status=status, intent=intent, message="Renderable terminal."
    )


async def test_place_ambiguity_clarify_returns_200() -> None:
    response = _terminal("needs_clarification", "clarify")
    response.data = {"reason": "place_ambiguity"}

    result = await _post(response)

    assert (result.status_code, result.json()["data"]["reason"]) == (
        200,
        "place_ambiguity",
    )


@pytest.mark.parametrize(
    ("status", "intent"),
    [
        ("partial", "partial"),
        ("blocked", "blocked"),
        ("empty", "plan_multi"),
        ("too_large", "plan_multi"),
    ],
)
async def test_renderable_terminal_returns_200(status: str, intent: str) -> None:
    result = await _post(_terminal(status, intent))

    assert (result.status_code, result.json()["status"]) == (200, status)


async def test_stale_invalid_selection_returns_400() -> None:
    response = _invalid_selection_response("This choice expired; please try again.")

    result = await _post(response)

    assert (result.status_code, result.json()["errors"][0]["code"]) == (
        400,
        "invalid_selection",
    )
