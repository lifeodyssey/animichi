"""FastAPI app factory — route handlers live in ``animichi.interfaces.routes``."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import structlog
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from animichi.agents.base import build_model_http_client
from animichi.clients.catalog_client import CatalogClient
from animichi.config.settings import Settings, get_settings
from animichi.infrastructure.gateways.geocoding import aclose_geocoding_client
from animichi.infrastructure.memory import postgres_memory_store
from animichi.infrastructure.session import SessionStore
from animichi.infrastructure.supabase.client import SupabaseClient
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.routes._deps import (  # noqa: F401
    _contains_json_invalid_error,
    _http_error_code,
    build_session_store,
    build_supabase_client,
    call_optional_async,
    setup_logfire,
)
from animichi.interfaces.routes._middleware import (
    register_credential_stripping_middleware,
    register_exception_handlers,
    register_observability_middleware,
)
from animichi.interfaces.routes.admission import build_startup_turn_outcome
from animichi.interfaces.routes.bangumi import router as bangumi_router
from animichi.interfaces.routes.byok import router as byok_router
from animichi.interfaces.routes.chat import router as chat_router
from animichi.interfaces.routes.conversations import router as conversations_router
from animichi.interfaces.routes.feedback import router as feedback_router
from animichi.interfaces.routes.health import router as health_router
from animichi.interfaces.routes.photo_search import router as photo_search_router
from animichi.interfaces.routes.search_preview import router as search_preview_router
from animichi.interfaces.routes.session_migration import (
    router as session_migration_router,
)

logger = structlog.get_logger(__name__)

# Re-export _call_optional_async for test backward compatibility.
_call_optional_async = call_optional_async


async def _run_startup_sweep(runtime_db: object) -> None:
    """Best-effort demand-driven sweep on Agent startup (TURN-3 #951)."""
    try:
        await build_startup_turn_outcome(runtime_db).sweep()
    except Exception:
        logger.warning("startup_sweep_failed", exc_info=True)


def _log_connect_failure(task: asyncio.Task[object]) -> None:
    """Warn immediately when the background pool connect fails (issue #694)."""
    if not task.cancelled() and task.exception() is not None:
        logger.warning(
            "database pool connect failed in the background",
            error=task.exception(),
        )


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
        await _run_startup_sweep(resolved_db)
    try:
        yield
    finally:
        await aclose_geocoding_client()


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


async def _close_clients(catalog_client: CatalogClient) -> None:
    """Close catalog then geocoding clients; both attempts run."""
    try:
        await catalog_client.aclose()
    finally:
        await aclose_geocoding_client()


async def _close_stores(
    runtime_session_store: SessionStore,
    runtime_db: object,
) -> None:
    """Close session store then db; both attempts run."""
    try:
        await call_optional_async(runtime_session_store, "close")
    finally:
        await call_optional_async(runtime_db, "close")


async def _close_runtime_resources(
    connect_task: asyncio.Task[object],
    catalog_client: CatalogClient,
    runtime_session_store: SessionStore,
    runtime_db: object,
) -> None:
    """Close runtime resources; every close attempt still runs."""
    try:
        await connect_task
    finally:
        try:
            await _close_clients(catalog_client)
        finally:
            await _close_stores(runtime_session_store, runtime_db)


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
    # Schema changes are never applied by the application. Neon catalog/user migrations run
    # through Atlas from migrations/neon; the remaining Supabase compatibility surface has its
    # own operator path. See docs/ops/migrations.md.
    catalog_client = build_catalog_client(resolved_settings)
    app.state.catalog_client = catalog_client
    app.state.runtime_api = RuntimeAPI(
        runtime_db,
        session_store=runtime_session_store,
        catalog=catalog_client,
        settings=resolved_settings,
        model_http_client=model_http_client,
        memory_store=postgres_memory_store(runtime_db),
    )
    app.state.db_client = runtime_db
    # The pool connect must not gate the container's readiness (issue #694):
    # it runs in the background so the port binds immediately. Until it
    # completes, DB work surfaces the client's "call connect() first" as a
    # clean 500 — see RuntimeAPI's lazy-repo comment in public_api.py.
    connect_task = asyncio.create_task(call_optional_async(runtime_db, "connect"))
    connect_task.add_done_callback(_log_connect_failure)

    async def _sweep_after_connect() -> None:
        try:
            await connect_task
        except BaseException:
            return
        await _run_startup_sweep(runtime_db)

    # Startup reconciliation runs once the pool is up, without blocking
    # readiness (TURN-3 #951): stale leases are reclaimed before the first
    # admission reads policy/quota/budget anyway.
    startup_sweep_task = asyncio.create_task(_sweep_after_connect())
    app.state.startup_sweep_task = startup_sweep_task
    try:
        yield
    finally:
        try:
            await startup_sweep_task
        finally:
            await _close_runtime_resources(
                connect_task, catalog_client, runtime_session_store, runtime_db
            )


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
            "x-byok-endpoint",
            # The actual BYOK headers byok-storage.ts (#467) sends. Without
            # these, browser CORS preflight rejects them before the request
            # ever reaches this container — this PR is the point where the
            # container-side header contract is established, so it belongs
            # here rather than waiting on Task 3.
            "X-BYOK-Provider",
            "X-BYOK-Key",
            "X-BYOK-Model",
            "X-BYOK-Base-Url",
        ],
    )
    register_exception_handlers(app)
    register_observability_middleware(app)
    # Registered last (= Starlette's outermost middleware — see rev4 P1-4 in
    # the BYOK spec, Task 2): must wrap observability_middleware and the
    # exception handlers above, so nothing downstream ever sees a raw BYOK
    # credential or Authorization header.
    register_credential_stripping_middleware(app)
    app.include_router(health_router)
    app.include_router(chat_router)
    app.include_router(byok_router)
    app.include_router(feedback_router)
    app.include_router(conversations_router)
    app.include_router(bangumi_router)
    app.include_router(search_preview_router)
    app.include_router(photo_search_router)
    app.include_router(session_migration_router)
    return app


app = create_fastapi_app()


def main() -> None:
    """Run the FastAPI service."""
    settings = get_settings()
    uvicorn.run(app, host=settings.service_host, port=settings.service_port)


if __name__ == "__main__":
    main()
