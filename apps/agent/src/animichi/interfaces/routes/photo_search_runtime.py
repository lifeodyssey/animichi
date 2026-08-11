"""Photo-search runtime construction (AGENT-1 #952).

The per-app wiring the thin route consumes: platform model, catalog, quota,
and the sessionless offer store, resolved lazily from request state (and
cached on the app), plus the adapter seams that bind the SearchPhoto use
case's vision and pipeline ports and the BYOK session cleanup.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal, cast

import httpx
from fastapi import Request

from animichi.agents.base import get_default_model
from animichi.agents.byok_models import ByokModel
from animichi.agents.photo_search import run_photo_search
from animichi.agents.photo_vision import ModelProvider, recognize_photo
from animichi.application.photo_offers import PhotoOfferStore
from animichi.application.photo_search_envelope import PipelineOutcome
from animichi.application.search_photo import (
    GpsPoint,
    ModelPrices,
    PhotoIdentity,
    PhotoVisionResult,
    RecognizePhoto,
    SearchPhoto,
    SearchPhotoCommand,
    SearchPhotoPolicy,
)
from animichi.clients.catalog_client import CatalogClient, CatalogClientProtocol
from animichi.config.settings import Settings
from animichi.infrastructure.observability.photo_search import PhotoSearchQuota
from animichi.infrastructure.photo_offers import InMemoryPhotoOfferStore
from animichi.interfaces.boundary.agent_models import (
    PhotoSearchRequest,
    PhotoSearchRequestGps,
)
from animichi.interfaces.db_repos import usage_repo
from animichi.interfaces.routes._deps import (
    TrustedAuthContext,
    _get_settings_from_request,
    _has_byok_headers,
)

Locale = Literal["ja", "zh", "en"]


@dataclass
class PhotoSearchRuntime:
    """Per-app photo-search wiring, injectable for tests."""

    platform_model: ModelProvider
    catalog: CatalogClientProtocol
    quota: PhotoSearchQuota = field(
        default_factory=lambda: PhotoSearchQuota(clock=lambda: datetime.now(UTC))
    )
    offers: PhotoOfferStore = field(default_factory=InMemoryPhotoOfferStore)


def build_photo_search_runtime(
    settings: Settings, catalog: CatalogClientProtocol, client: httpx.AsyncClient
) -> PhotoSearchRuntime:
    del settings  # kept for signature symmetry with `_build_from_state`
    return PhotoSearchRuntime(
        platform_model=get_default_model(http_client=client), catalog=catalog
    )


def _build_from_state(request: Request) -> PhotoSearchRuntime:
    settings = _get_settings_from_request(request)
    catalog = getattr(request.app.state, "catalog_client", None)
    if not isinstance(catalog, CatalogClient):
        catalog = CatalogClient(base_url=settings.catalog_api_url)
    client = getattr(request.app.state, "model_http_client", None)
    if not isinstance(client, httpx.AsyncClient):
        raise RuntimeError("photo-search requires the lifespan HTTP client")
    return build_photo_search_runtime(settings, catalog, client)


def get_photo_runtime(request: Request) -> PhotoSearchRuntime:
    existing = getattr(request.app.state, "photo_search", None)
    if isinstance(existing, PhotoSearchRuntime):
        return existing
    runtime = _build_from_state(request)
    request.app.state.photo_search = runtime
    return runtime


def locale_of(request: Request) -> Locale:
    value = request.headers.get("x-locale", "ja")
    return cast(Locale, value) if value in ("ja", "zh", "en") else "ja"


def quota_key(auth: TrustedAuthContext, request: Request) -> str:
    """Meter on the edge-asserted X-User-Id (member or worker-minted anonymous).

    Never `x-session-id`: that header is client-controlled (the Worker
    forwards it for chat session continuity), so keying on it would let a
    caller reset the meter per request. The host fallback covers direct/dev
    access only.
    """
    if auth.user_id is not None:
        return auth.user_id
    host = request.client.host if request.client else "anon"
    return host


class ByokSessionAdapter:
    """Route adapter: SearchPhoto owns BYOK client cleanup via this seam."""

    def __init__(self, byok: ByokModel) -> None:
        self._byok = byok

    async def close(self) -> None:
        await self._byok.client.aclose()


def _vision_call(
    runtime: PhotoSearchRuntime, byok_model: ByokModel | None
) -> Callable[[list[bytes], str], Awaitable[PhotoVisionResult]]:
    byok = byok_model.model if byok_model is not None else None

    async def call(images: list[bytes], locale: str) -> PhotoVisionResult:
        return await recognize_photo(runtime.platform_model, byok, images, locale)

    return call


def _pipeline_call(
    runtime: PhotoSearchRuntime,
) -> Callable[[RecognizePhoto, GpsPoint | None], Awaitable[PipelineOutcome]]:
    async def run(recognize: RecognizePhoto, gps: GpsPoint | None) -> PipelineOutcome:
        return await run_photo_search(recognize, runtime.catalog, gps)

    return run


def build_search_photo(
    runtime: PhotoSearchRuntime,
    request: Request,
    settings: Settings,
    byok_model: ByokModel | None,
) -> SearchPhoto:
    return SearchPhoto(
        vision=_vision_call(runtime, byok_model),
        pipeline=_pipeline_call(runtime),
        offers=runtime.offers,
        quota=runtime.quota,
        policy=SearchPhotoPolicy(
            quota_anon=settings.photo_search_quota_anon,
            quota_member=settings.photo_search_quota_member,
            prices=ModelPrices(
                input_usd_per_mtok=settings.model_input_cost_per_mtok_usd,
                output_usd_per_mtok=settings.model_output_cost_per_mtok_usd,
            ),
        ),
        usage_repo=usage_repo(request.app.state.db_client),
        byok=ByokSessionAdapter(byok_model) if byok_model is not None else None,
    )


def search_command(
    request: Request, auth: TrustedAuthContext, body: PhotoSearchRequest
) -> SearchPhotoCommand:
    return SearchPhotoCommand(
        image_base64=body.image_base64,
        mime_type=body.mime_type,
        gps=_gps(body.gps),
        locale=locale_of(request),
        identity=PhotoIdentity(user_id=auth.user_id, user_type=auth.user_type),
        quota_key=quota_key(auth, request),
        has_byok=_has_byok_headers(request),
    )


def _gps(gps: PhotoSearchRequestGps | None) -> GpsPoint | None:
    if gps is None:
        return None
    return GpsPoint(lat=gps.lat, lng=gps.lng)
