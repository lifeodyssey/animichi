"""HTTP boundary tests for caller-selected model aliases."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from agent.tests.unit.conftest_fastapi import async_client, build_app

_BAD_ALIASES = ("__nope__", "openai:x@https://evil.example")


def _assert_invalid_alias(response_status: int, body: object) -> None:
    assert response_status == 400
    assert isinstance(body, dict)
    errors = body.get("errors")
    assert isinstance(errors, list)
    assert errors[0]["code"] == "invalid_model_alias"


@pytest.mark.parametrize("model_alias", _BAD_ALIASES)
async def test_runtime_rejects_alias_before_agent_sink(model_alias: str) -> None:
    app, _ = build_app()
    with patch(
        "agent.interfaces.public_api.run_animichi_agent",
        new_callable=AsyncMock,
    ) as sink:
        async with async_client(app) as client:
            response = await client.post(
                "/v1/runtime", json={"text": "hello", "model": model_alias}
            )

    _assert_invalid_alias(response.status_code, response.json())
    sink.assert_not_awaited()


@pytest.mark.parametrize("model_alias", _BAD_ALIASES)
async def test_runtime_stream_rejects_alias_before_agent_sink(
    model_alias: str,
) -> None:
    app, _ = build_app()
    with patch(
        "agent.interfaces.public_api.run_animichi_agent",
        new_callable=AsyncMock,
    ) as sink:
        async with async_client(app) as client:
            response = await client.post(
                "/v1/runtime/stream",
                json={"text": "hello", "model": model_alias},
            )

    _assert_invalid_alias(response.status_code, response.json())
    sink.assert_not_awaited()


@pytest.mark.parametrize("model_alias", _BAD_ALIASES)
async def test_selected_route_rejects_alias_before_route_sink(
    model_alias: str,
) -> None:
    app, _ = build_app()
    with patch(
        "agent.interfaces.public_api.execute_selected_route",
        new_callable=AsyncMock,
        side_effect=RuntimeError("selected route sink must not run"),
    ) as sink:
        async with async_client(app) as client:
            response = await client.post(
                "/v1/runtime",
                json={"selected_point_ids": ["point-1"], "model": model_alias},
            )

    _assert_invalid_alias(response.status_code, response.json())
    sink.assert_not_awaited()
