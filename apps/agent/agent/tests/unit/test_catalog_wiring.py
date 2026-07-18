"""HTTP-surface wiring: RuntimeAPI injects a CatalogClient into the agent.

These verify the catalog seam at the interface layer:
  - ``RuntimeAPI`` forwards an injected catalog client to ``run_animichi_agent``.
  - The app factory constructs a real ``CatalogClient`` from settings.
A ``MockCatalogClient`` (spy) is injected via the ``RuntimeAPI`` constructor seam,
so we assert the agent drove its data path through that client.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from fastapi.testclient import TestClient

from agent.clients.catalog_client import CatalogClient
from agent.config.settings import Settings
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.schemas import PublicAPIRequest
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.unit.conftest_fastapi import build_stub_db
from agent.tests.unit.conftest_public_api import make_result


def _greet_result() -> object:
    return make_result(intent="general_qa", message="hi")


async def test_runtime_api_forwards_catalog_to_agent() -> None:
    db = build_stub_db()
    catalog = MockCatalogClient()
    api = RuntimeAPI(
        db,
        session_store=InMemorySessionStore(),
        catalog=catalog,
        model_http_client=MagicMock(),
    )
    request = PublicAPIRequest(text="hello", locale="ja")

    with patch(
        "agent.interfaces.public_api.run_animichi_agent",
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
    api = RuntimeAPI(
        db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
    )
    request = PublicAPIRequest(text="hello", locale="ja")

    with patch(
        "agent.interfaces.public_api.run_animichi_agent",
        return_value=_greet_result(),
    ) as runner:
        await api.handle(request)

    assert isinstance(runner.await_args.kwargs["catalog"], CatalogClient)


def test_settings_has_catalog_api_url_default() -> None:
    settings = Settings()
    assert settings.catalog_api_url == "http://localhost:8787"


def test_app_factory_builds_catalog_client() -> None:
    from agent.interfaces.fastapi_service import build_catalog_client

    settings = Settings(catalog_api_url="https://catalog.test")
    client = build_catalog_client(settings)
    assert isinstance(client, CatalogClient)
    assert client._base_url == "https://catalog.test"


def test_fastapi_lifespan_closes_catalog_client() -> None:
    catalog = MagicMock(spec=CatalogClient)
    catalog.aclose = AsyncMock()
    model_client = MagicMock(spec=httpx.AsyncClient)
    model_client.aclose = AsyncMock()
    session_store = InMemorySessionStore()
    db = build_stub_db()
    with (
        patch(
            "agent.interfaces.fastapi_service.build_catalog_client",
            return_value=catalog,
        ),
        patch(
            "agent.interfaces.fastapi_service.build_model_http_client",
            return_value=model_client,
        ),
    ):
        from agent.interfaces.fastapi_service import create_fastapi_app

        app = create_fastapi_app(db=db, session_store=session_store)
        with TestClient(app):
            assert app.state.catalog_client is catalog
    catalog.aclose.assert_awaited_once()
