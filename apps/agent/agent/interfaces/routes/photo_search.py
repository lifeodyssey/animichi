"""Photo-search phase 1 boundary: ``POST /v1/photo-search`` (+ confirm ping).

Anonymous requests are allowed (metered on the anon tier); the Worker edge
still owns real auth, and this route only reads the trusted headers.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from agent.agents.photo_search import (
    GpsPoint,
    PhotoSearchResponse,
    run_photo_search,
)
from agent.agents.vision_supply_router import (
    EndpointId,
    VisionCapabilityRegistry,
    VisionProvider,
    QuotaTier,
    VisionSupply,
    quota_guidance,
    quota_tier_for,
)
from agent.clients.catalog_client import CatalogClient, CatalogClientProtocol
from agent.clients.gemini_vision import GeminiVisionProvider
from agent.config.settings import Settings
from agent.infrastructure.observability.photo_search import (
    LayerHit,
    PhotoSearchQuota,
    PhotoSearchSignals,
    QueryType,
    QuotaKey,
    record_photo_search,
)
from agent.interfaces.routes._deps import (
    TrustedAuthContext,
    _get_settings_from_request,
    _get_trusted_auth_context,
)

router = APIRouter(prefix="/v1", tags=["photo-search"])

SUPPORTED_IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
Locale = Literal["ja", "zh", "en"]


class GpsBody(BaseModel):
    lat: float
    lng: float


class PhotoSearchBody(BaseModel):
    image_base64: str = Field(min_length=1)
    mime_type: str
    gps: GpsBody | None = None


class PhotoConfirmBody(BaseModel):
    query_type: QueryType
    gps_available: bool
    layer_hit: LayerHit
    candidates_shown: int = Field(ge=0)


@dataclass
class PhotoSearchRuntime:
    """Per-app photo-search wiring, injectable for tests."""

    platform_provider: VisionProvider
    catalog: CatalogClientProtocol
    registry: VisionCapabilityRegistry = field(default_factory=VisionCapabilityRegistry)
    quota: PhotoSearchQuota = field(
        default_factory=lambda: PhotoSearchQuota(clock=lambda: datetime.now(UTC))
    )
    byok_providers: dict[EndpointId, VisionProvider] = field(default_factory=dict)


def build_photo_search_runtime(
    settings: Settings, catalog: CatalogClientProtocol
) -> PhotoSearchRuntime:
    provider = GeminiVisionProvider(api_key=settings.gemini_api_key)
    return PhotoSearchRuntime(platform_provider=provider, catalog=catalog)


def _build_from_state(request: Request) -> PhotoSearchRuntime:
    settings = _get_settings_from_request(request)
    catalog = getattr(request.app.state, "catalog_client", None)
    if not isinstance(catalog, CatalogClient):
        catalog = CatalogClient(base_url=settings.catalog_api_url)
    return build_photo_search_runtime(settings, catalog)


def _get_photo_runtime(request: Request) -> PhotoSearchRuntime:
    existing = getattr(request.app.state, "photo_search", None)
    if isinstance(existing, PhotoSearchRuntime):
        return existing
    runtime = _build_from_state(request)
    request.app.state.photo_search = runtime
    return runtime


def _locale(request: Request) -> Locale:
    value = request.headers.get("x-locale", "ja")
    return cast(Locale, value) if value in ("ja", "zh", "en") else "ja"


def _decode_image(body: PhotoSearchBody) -> bytes:
    if body.mime_type not in SUPPORTED_IMAGE_TYPES:
        raise HTTPException(
            status_code=415, detail={"code": "unsupported_image_format"}
        )
    try:
        return base64.b64decode(body.image_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=422, detail={"code": "invalid_image"}) from exc


def _byok_endpoint(request: Request) -> EndpointId | None:
    value = request.headers.get("x-byok-endpoint")
    return EndpointId(value) if value else None


def _quota_limit(settings: Settings, tier: QuotaTier) -> int | None:
    if tier == "member":
        return settings.photo_search_quota_member
    return settings.photo_search_quota_anon


def _quota_key(auth: TrustedAuthContext, request: Request) -> QuotaKey:
    if auth.user_id is not None:
        return QuotaKey(auth.user_id)
    session = request.headers.get("x-session-id")
    host = request.client.host if request.client else "anon"
    return QuotaKey(session or host)


def _check_quota(
    runtime: PhotoSearchRuntime,
    settings: Settings,
    tier: QuotaTier,
    key: QuotaKey,
    byok: EndpointId | None,
) -> None:
    if runtime.quota.consume(tier, key, _quota_limit(settings, tier)):
        return
    detail = {"code": "photo_search_quota_exhausted", "guidance": quota_guidance(byok)}
    raise HTTPException(status_code=429, detail=detail)


def _supply(runtime: PhotoSearchRuntime, byok: EndpointId | None) -> VisionSupply:
    provider = runtime.byok_providers.get(byok) if byok is not None else None
    return VisionSupply(
        platform=runtime.platform_provider,
        registry=runtime.registry,
        byok=provider,
        byok_endpoint=byok,
    )


def _gps(body: PhotoSearchBody) -> GpsPoint | None:
    if body.gps is None:
        return None
    return GpsPoint(lat=body.gps.lat, lng=body.gps.lng)


@router.post(
    "/photo-search",
    response_model=PhotoSearchResponse,
    response_model_exclude_none=True,
    responses={415: {"description": "Unsupported image format"}},
)
async def handle_photo_search(
    request: Request,
    body: PhotoSearchBody,
    auth: Annotated[TrustedAuthContext, Depends(_get_trusted_auth_context)],
) -> PhotoSearchResponse:
    """Run the standalone vision pipeline and reply with a chat-shaped envelope."""
    runtime = _get_photo_runtime(request)
    image = _decode_image(body)
    byok = _byok_endpoint(request)
    authenticated = auth.user_id is not None
    tier = quota_tier_for(authenticated)
    _check_quota(runtime, _get_settings_from_request(request), tier, _quota_key(auth, request), byok)
    return await _run_pipeline(runtime, byok, image, body, request, authenticated)


async def _run_pipeline(
    runtime: PhotoSearchRuntime,
    byok: EndpointId | None,
    image: bytes,
    body: PhotoSearchBody,
    request: Request,
    authenticated: bool,
) -> PhotoSearchResponse:
    outcome = await run_photo_search(
        _supply(runtime, byok),
        runtime.catalog,
        [image],
        _gps(body),
        _locale(request),
        authenticated,
    )
    record_photo_search(outcome.signals)
    return outcome.response


@router.post("/photo-search/confirm", status_code=204)
async def handle_photo_confirm(body: PhotoConfirmBody) -> None:
    """Record the ``user_confirmed`` telemetry signal for a shown candidate."""
    record_photo_search(
        PhotoSearchSignals(
            query_type=body.query_type,
            gps_available=body.gps_available,
            layer_hit=body.layer_hit,
            candidates_shown=body.candidates_shown,
            user_confirmed=True,
        )
    )
