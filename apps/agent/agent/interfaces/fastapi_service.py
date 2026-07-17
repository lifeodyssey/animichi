"""FastAPI app factory — route handlers live in ``agent.interfaces.routes``."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent.agents.base import build_model_http_client
from agent.clients.catalog_client import CatalogClient
from agent.config.settings import Settings, get_settings
from agent.infrastructure.session import SessionStore
from agent.infrastructure.supabase.client import SupabaseClient
from agent.interfaces.public_api import RuntimeAPI
from agent.interfaces.routes._deps import (  # noqa: F401
    _contains_json_invalid_error,
    _http_error_code,
    build_session_store,
    build_supabase_client,
    call_optional_async,
    setup_logfire,
)
from agent.interfaces.routes._middleware import (
    register_exception_handlers,
    register_observability_middleware,
)
from agent.interfaces.routes.bangumi import router as bangumi_router
from agent.interfaces.routes.chat import router as chat_router
from agent.interfaces.routes.conversations import router as conversations_router
from agent.interfaces.routes.feedback import router as feedback_router
from agent.interfaces.routes.health import router as health_router
from agent.interfaces.routes.runtime import router as runtime_router
from agent.interfaces.routes.search_preview import router as search_preview_router

# Re-export _call_optional_async for test backward compatibility.
_call_optional_async = call_optional_async


def build_catalog_client(settings: Settings) -> CatalogClient:
    """Construct the shared Catalog read-path client from settings."""
    return CatalogClient(base_url=settings.catalog_api_url)


@asynccontextmanager
async def _lifespan_with_runtime_api(
    app: FastAPI,
    runtime_api: RuntimeAPI,
    db: object | None,
    model_http_client: httpx.AsyncClient,
) -> AsyncIterator[None]:
    """Lifespan branch: runtime_api provided externally (test / injection)."""
    runtime_api.bind_model_http_client(model_http_client)
    app.state.runtime_api = runtime_api
    resolved_db = db if db is not None else getattr(runtime_api, "_db", None)
    if resolved_db is not None:
        app.state.db_client = resolved_db
    yield


def _resolve_session_store(
    session_store: SessionStore | None,
    runtime_db: object,
) -> SessionStore:
    """Resolve the session store from the provided store or the DB client."""
    if session_store is not None:
        return session_store
    if isinstance(runtime_db, SupabaseClient):
        return build_session_store(runtime_db)
    raise RuntimeError(
        "create_fastapi_app(..., db=...) requires session_store"
        " for non-Supabase db adapters."
    )


@asynccontextmanager
async def _lifespan_build_runtime(
    app: FastAPI,
    resolved_settings: Settings,
    db: object | None,
    session_store: SessionStore | None,
    model_http_client: httpx.AsyncClient,
) -> AsyncIterator[None]:
    """Lifespan branch: build RuntimeAPI from scratch (normal startup)."""
    runtime_db = db if db is not None else build_supabase_client(resolved_settings)
    runtime_session_store = _resolve_session_store(session_store, runtime_db)
    await call_optional_async(runtime_db, "connect")
    # Migrations are managed by Supabase CLI (`supabase db push` in CI/CD).
    # Local dev: `supabase start` applies migrations automatically.
    # See: deploy.yml and https://supabase.com/docs/guides/deployment/database-migrations
    catalog_client = build_catalog_client(resolved_settings)
    app.state.catalog_client = catalog_client
    app.state.runtime_api = RuntimeAPI(
        runtime_db,
        session_store=runtime_session_store,
        catalog=catalog_client,
        settings=resolved_settings,
        model_http_client=model_http_client,
    )
    app.state.db_client = runtime_db
    try:
        yield
    finally:
        await catalog_client.aclose()
        await call_optional_async(runtime_session_store, "close")
        await call_optional_async(runtime_db, "close")


def create_fastapi_app(
    *,
    runtime_api: RuntimeAPI | None = None,
    settings: Settings | None = None,
    db: object | None = None,
    session_store: SessionStore | None = None,
) -> FastAPI:
    """Build the FastAPI service app for the runtime."""
    resolved_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = resolved_settings
        model_http_client = build_model_http_client(resolved_settings)
        app.state.model_http_client = model_http_client
        try:
            if runtime_api is not None:
                async with _lifespan_with_runtime_api(
                    app, runtime_api, db, model_http_client
                ):
                    yield
                return
            async with _lifespan_build_runtime(
                app,
                resolved_settings,
                db,
                session_store,
                model_http_client,
            ):
                yield
        finally:
            await model_http_client.aclose()

    app = FastAPI(lifespan=lifespan)
    setup_logfire(resolved_settings, app=app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[resolved_settings.cors_allowed_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=[
            "Content-Type",
            "Authorization",
            "X-User-Id",
            "X-User-Type",
            "x-session-id",
            "x-locale",
        ],
    )
    register_exception_handlers(app)
    register_observability_middleware(app)
    app.include_router(health_router)
    app.include_router(runtime_router)
    app.include_router(chat_router)
    app.include_router(feedback_router)
    app.include_router(conversations_router)
    app.include_router(bangumi_router)
    app.include_router(search_preview_router)
    return app


app = create_fastapi_app()


def main() -> None:
    """Run the FastAPI service."""
    settings = get_settings()
    uvicorn.run(app, host=settings.service_host, port=settings.service_port)


if __name__ == "__main__":
    main()
