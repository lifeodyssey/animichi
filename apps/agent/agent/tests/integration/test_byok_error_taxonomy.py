"""BYOK error taxonomy at the `RuntimeAPI` layer (#284 T3-AC6, T3-AC7).

Exercises `_execute_pipeline` directly, mirroring the pattern
`test_model_failover.py` already uses for the server-default model
(`api._dispatch_request(...)`, `patch(..., side_effect=AssertionError(...))`
as a canary for "must never be called") — the lightest faithful way to
reach the new BYOK branch without spinning up the full agent pipeline.
"""

from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.models import Model

from agent.clients.catalog_client import CatalogClientProtocol
from agent.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from agent.interfaces.routes._deps import _http_status_for_response

pytestmark = pytest.mark.integration

_FAKE_KEY = "sk-fake-secret-value"
_FAKE_BASE_URL = "https://byok.example.test/v1"


def _api(client: httpx.AsyncClient) -> RuntimeAPI:
    return RuntimeAPI(
        object(),
        catalog=cast(CatalogClientProtocol, object()),
        model_http_client=client,
    )


async def test_byok_credential_rejection_maps_to_the_typed_code() -> None:
    """T3-AC6: a 401 from the caller's own provider is `byok_credential_rejected`,
    never the generic `provider_error`/`internal_error` branch."""
    client = httpx.AsyncClient()
    api = _api(client)
    request = PublicAPIRequest(text="hello")
    with patch.object(
        api,
        "_model_request",
        new=AsyncMock(side_effect=ModelHTTPError(401, "byok-model")),
    ):
        _result, response, _delta = await api._execute_pipeline(
            request, None, [], object(), None, object(), None, True
        )
    try:
        assert response.errors[0].code == "byok_credential_rejected"
        assert _http_status_for_response(response) == 403
    finally:
        await client.aclose()


async def test_byok_credential_rejection_never_leaks_the_key_or_base_url() -> None:
    """T3-AC7: the response body carries no substring of the submitted
    key or base_url — the exception's own `str()` is never surfaced."""
    client = httpx.AsyncClient()
    api = _api(client)
    request = PublicAPIRequest(text="hello")
    leaking_body = f"unauthorized key={_FAKE_KEY} base_url={_FAKE_BASE_URL}"
    with patch.object(
        api,
        "_model_request",
        new=AsyncMock(side_effect=ModelHTTPError(403, "byok-model", body=leaking_body)),
    ):
        _result, response, _delta = await api._execute_pipeline(
            request, None, [], object(), None, object(), None, True
        )
    try:
        body_repr = repr(response.model_dump(mode="json"))
        assert _FAKE_KEY not in body_repr
        assert _FAKE_BASE_URL not in body_repr
    finally:
        await client.aclose()


async def test_byok_turn_never_falls_back_to_the_server_default_model() -> None:
    """T3-AC6: zero calls to `get_default_model` on a BYOK turn, success or
    failure — a concrete `Model` instance always bypasses the default path."""
    client = httpx.AsyncClient()
    api = _api(client)
    request = PublicAPIRequest(text="hello")
    byok_model = cast(Model, object())
    with (
        patch.object(
            api,
            "_model_request",
            new=AsyncMock(side_effect=ModelHTTPError(401, "byok-model")),
        ),
        patch(
            "agent.interfaces.public_api.get_default_model",
            side_effect=AssertionError("must not fall back to the server default"),
        ),
    ):
        await api._execute_pipeline(
            request, None, [], byok_model, None, object(), None, True
        )
    await client.aclose()


async def test_non_byok_model_rejection_still_uses_the_generic_taxonomy() -> None:
    """Regression: the same exception on a non-BYOK turn is unaffected —
    `is_byok=False` must not accidentally widen the new branch."""
    client = httpx.AsyncClient()
    api = _api(client)
    request = PublicAPIRequest(text="hello")
    with patch.object(
        api,
        "_model_request",
        new=AsyncMock(side_effect=ModelHTTPError(401, "server-model")),
    ):
        _result, response, _delta = await api._execute_pipeline(
            request, None, [], object(), None, object(), None, False
        )
    try:
        assert response.errors[0].code != "byok_credential_rejected"
    finally:
        await client.aclose()
