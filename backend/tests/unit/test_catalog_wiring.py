"""HTTP-surface wiring: RuntimeAPI injects a CatalogClient into the agent.

These verify the catalog seam at the interface layer:
  - ``RuntimeAPI`` forwards an injected catalog client to ``run_pilgrimage_agent``.
  - The app factory constructs a real ``CatalogClient`` from settings.
A ``MockCatalogClient`` (spy) is injected via the ``RuntimeAPI`` constructor seam,
so we assert the agent drove its data path through that client.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

from starlette.responses import StreamingResponse

from backend.clients.catalog_client import CatalogClient
from backend.config.settings import Settings
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.interfaces.public_api import RuntimeAPI
from backend.interfaces.schemas import PublicAPIRequest
from backend.tests.eval.mock_catalog_client import MockCatalogClient
from backend.tests.unit.conftest_fastapi import async_client, build_app, build_stub_db
from backend.tests.unit.conftest_public_api import make_result


def _greet_result() -> object:
    return make_result(intent="greet_user", message="hi")


async def test_runtime_api_forwards_catalog_to_agent() -> None:
    db = build_stub_db()
    catalog = MockCatalogClient()
    api = RuntimeAPI(db, session_store=InMemorySessionStore(), catalog=catalog)
    request = PublicAPIRequest(text="hello", locale="ja")

    with patch(
        "backend.interfaces.public_api.run_pilgrimage_agent",
        return_value=_greet_result(),
    ) as runner:
        await api.handle(request)

    assert runner.await_args.kwargs["catalog"] is catalog


async def test_runtime_api_defaults_catalog_to_real_client() -> None:
    """With no client injected, RuntimeAPI still forwards a real CatalogClient.

    The agent is catalog-only, so the runner must always receive a client; the
    default is a real CatalogClient built from settings (never ``None``).
    """
    db = build_stub_db()
    api = RuntimeAPI(db, session_store=InMemorySessionStore())
    request = PublicAPIRequest(text="hello", locale="ja")

    with patch(
        "backend.interfaces.public_api.run_pilgrimage_agent",
        return_value=_greet_result(),
    ) as runner:
        await api.handle(request)

    assert isinstance(runner.await_args.kwargs["catalog"], CatalogClient)


def test_settings_has_catalog_api_url_default() -> None:
    settings = Settings()
    assert settings.catalog_api_url == "http://localhost:8787"


def test_app_factory_builds_catalog_client() -> None:
    from backend.interfaces.fastapi_service import build_catalog_client

    settings = Settings(catalog_api_url="http://catalog.test")
    client = build_catalog_client(settings)
    assert isinstance(client, CatalogClient)
    assert client._base_url == "http://catalog.test"


def _vercel_body() -> dict[str, object]:
    return {
        "trigger": "submit-message",
        "id": "msg-1",
        "messages": [
            {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "京吹"}]}
        ],
        "locale": "ja",
    }


def _sse_response() -> StreamingResponse:
    async def _gen() -> object:
        yield "data: [DONE]\n\n"

    return StreamingResponse(_gen(), media_type="text/event-stream")


async def test_chat_route_injects_catalog_into_deps() -> None:
    mock_db = build_stub_db()
    runtime = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
    app, _ = build_app(runtime_api=runtime, db=mock_db)
    catalog = MockCatalogClient()
    app.state.catalog_client = catalog

    with patch(
        "backend.interfaces.routes.chat.VercelAIAdapter.dispatch_request",
        new_callable=AsyncMock,
        return_value=_sse_response(),
    ) as mock_dispatch:
        async with async_client(app) as client:
            await client.post(
                "/v1/chat",
                content=json.dumps(_vercel_body()),
                headers={"Content-Type": "application/json", "X-User-Id": "user-1"},
            )

    assert mock_dispatch.call_args.kwargs["deps"].catalog is catalog
