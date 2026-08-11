"""BYOK error taxonomy at the `RuntimeAPI` layer (#284 T3-AC6, T3-AC7).

Exercises the TurnExecution port (`_RuntimeTurnExecution`) with a
`run_animichi_agent` canary — the lightest faithful way to reach the BYOK
branch without spinning up the full agent pipeline.
"""

from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.models import Model

from animichi.application.agent_turn import ExecutionResult, TextTurn
from animichi.clients.catalog_client import CatalogClientProtocol
from animichi.interfaces.public_api import (
    PublicAPIRequest,
    RuntimeAPI,
    _RuntimeTurnExecution,
)

pytestmark = pytest.mark.integration

_FAKE_KEY = "sk-fake-secret-value"
_FAKE_BASE_URL = "https://byok.example.test/v1"


def _api(client: httpx.AsyncClient) -> RuntimeAPI:
    return RuntimeAPI(
        object(),
        catalog=cast(CatalogClientProtocol, object()),
        model_http_client=client,
    )


def _execution(
    api: RuntimeAPI, *, model: object, is_byok: bool
) -> _RuntimeTurnExecution:
    return _RuntimeTurnExecution(
        api,
        request=PublicAPIRequest(text="hello"),
        model=model,
        is_byok=is_byok,
        user_id=None,
        on_step=None,
    )


async def _run_pipeline(
    api: RuntimeAPI, *, model: object, is_byok: bool, exc: Exception
) -> ExecutionResult:
    with patch(
        "animichi.interfaces.public_api.run_animichi_agent",
        new=AsyncMock(side_effect=exc),
    ):
        return await _execution(api, model=model, is_byok=is_byok).execute(
            TextTurn(text="hello", locale="ja"),
            context=None,
            history=(),
            model=model,
            on_step=None,
        )


async def test_byok_credential_rejection_maps_to_the_typed_code() -> None:
    """T3-AC6: a 401 from the caller's own provider is `byok_credential_rejected`,
    never the generic `provider_error`/`internal_error` branch."""
    client = httpx.AsyncClient()
    api = _api(client)
    try:
        executed = await _run_pipeline(
            api,
            model=cast(Model, object()),
            is_byok=True,
            exc=ModelHTTPError(401, "byok-model"),
        )
        assert executed.error_code == "byok_credential_rejected"
    finally:
        await client.aclose()


async def test_byok_credential_rejection_never_leaks_the_key_or_base_url() -> None:
    """T3-AC7: the error code carries no substring of the submitted key or
    base_url — the exception's own `str()` is never surfaced."""
    client = httpx.AsyncClient()
    api = _api(client)
    leaking_body = f"unauthorized key={_FAKE_KEY} base_url={_FAKE_BASE_URL}"
    try:
        executed = await _run_pipeline(
            api,
            model=cast(Model, object()),
            is_byok=True,
            exc=ModelHTTPError(403, "byok-model", body=leaking_body),
        )
        assert executed.error_code == "byok_credential_rejected"
        assert executed.error_details is None
        assert _FAKE_KEY not in executed.error_code
        assert _FAKE_BASE_URL not in executed.error_code
    finally:
        await client.aclose()


async def test_byok_turn_never_falls_back_to_the_server_default_model() -> None:
    """T3-AC6: zero calls to `get_default_model` on a BYOK turn — a concrete
    `Model` instance always bypasses the default path."""
    client = httpx.AsyncClient()
    api = _api(client)
    byok_model = cast(Model, object())
    try:
        with (
            patch(
                "animichi.interfaces.public_api.run_animichi_agent",
                new=AsyncMock(side_effect=ModelHTTPError(401, "byok-model")),
            ),
            patch(
                "animichi.agents.animichi_runner.get_default_model",
                side_effect=AssertionError("must not fall back to the server default"),
            ),
        ):
            await _execution(api, model=byok_model, is_byok=True).execute(
                TextTurn(text="hello", locale="ja"),
                context=None,
                history=(),
                model=byok_model,
                on_step=None,
            )
    finally:
        await client.aclose()


async def test_non_byok_model_rejection_still_uses_the_generic_taxonomy() -> None:
    """Regression: the same exception on a non-BYOK turn is unaffected —
    `is_byok=False` must not accidentally widen the new branch."""
    client = httpx.AsyncClient()
    api = _api(client)
    try:
        executed = await _run_pipeline(
            api,
            model=cast(Model, object()),
            is_byok=False,
            exc=ModelHTTPError(401, "server-model"),
        )
        assert executed.error_code != "byok_credential_rejected"
    finally:
        await client.aclose()
