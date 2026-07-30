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

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from agent.agents.photo_search import (
    GpsPoint,
    PhotoSearchResponse,
    run_photo_search,
)
from agent.agents.vision_supply_router import (
    EndpointId,
    GuidancePremise,
    QuotaTier,
    VisionCapabilityRegistry,
    VisionProvider,
    VisionSupply,
    quota_guidance,
    quota_tier_for,
)
from agent.clients.catalog_client import CatalogClient, CatalogClientProtocol
from agent.clients.gemini_vision import GeminiVisionProvider, sniff_image_mime
from agent.config.settings import Settings
from agent.infrastructure.observability.photo_search import (
    ClientQueryType,
    LayerHit,
    PhotoSearchQuota,
    PhotoSearchSignals,
    QuotaKey,
    record_photo_search,
)
from agent.interfaces.routes._deps import (
    TrustedAuthContext,
    _error_response,
    _get_settings_from_request,
    _get_trusted_auth_context,
)
from agent.interfaces.usage_metering import is_anonymous_identity

router = APIRouter(prefix="/v1", tags=["photo-search"])

SUPPORTED_IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
Locale = Literal["ja", "zh", "en"]

# 8 MiB image cap (matches the client-side pre-check); base64 expands
# ceil(n/3)*4. The Field cap sits at 2x as a parse-time belt (422 for absurd
# payloads); the semantic limit below it returns the typed 413.
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_BASE64_CHARS = ((MAX_IMAGE_BYTES + 2) // 3) * 4


class GpsBody(BaseModel):
    lat: float
    lng: float


class PhotoSearchBody(BaseModel):
    image_base64: str = Field(min_length=1, max_length=2 * MAX_IMAGE_BASE64_CHARS)
    mime_type: str
    gps: GpsBody | None = None


class PhotoConfirmBody(BaseModel):
    query_type: ClientQueryType
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


@dataclass(frozen=True)
class PhotoSearchRejection(Exception):
    """A typed rejection turned into the service error envelope."""

    status_code: int
    code: Literal[
        "unsupported_image_format",
        "invalid_image",
        "image_too_large",
        "photo_search_quota_exhausted",
    ]
    message: str
    guidance: GuidancePremise | None = None


def _rejection_response(rejection: PhotoSearchRejection) -> JSONResponse:
    details = (
        {"guidance": rejection.guidance} if rejection.guidance is not None else None
    )
    return _error_response(
        rejection.code,
        rejection.message,
        status_code=rejection.status_code,
        details=details,
    )


def _decode_image(body: PhotoSearchBody) -> bytes:
    if body.mime_type not in SUPPORTED_IMAGE_TYPES:
        raise PhotoSearchRejection(
            415, "unsupported_image_format", "This image format is not supported."
        )
    if len(body.image_base64) > MAX_IMAGE_BASE64_CHARS:
        raise PhotoSearchRejection(
            413, "image_too_large", "The image is larger than the 8 MB limit."
        )
    return _validated_bytes(body.image_base64)


def _validated_bytes(image_base64: str) -> bytes:
    """Decode and magic-byte-check: the client's mime label is never trusted."""
    try:
        image = base64.b64decode(image_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise PhotoSearchRejection(
            422, "invalid_image", "The image payload could not be decoded."
        ) from exc
    if sniff_image_mime(image) not in SUPPORTED_IMAGE_TYPES:
        raise PhotoSearchRejection(
            415, "unsupported_image_format", "This image format is not supported."
        )
    return image


def _byok_endpoint(request: Request) -> EndpointId | None:
    value = request.headers.get("x-byok-endpoint")
    return EndpointId(value) if value else None


def _quota_limit(settings: Settings, tier: QuotaTier) -> int | None:
    if tier == "member":
        return settings.photo_search_quota_member
    return settings.photo_search_quota_anon


def _quota_key(auth: TrustedAuthContext, request: Request) -> QuotaKey:
    """Meter on the edge-asserted X-User-Id (member or worker-minted anonymous).

    Never `x-session-id`: that header is client-controlled (the Worker forwards
    it for chat session continuity), so keying on it would let a caller reset
    the meter per request. The host fallback covers direct/dev access only.
    """
    if auth.user_id is not None:
        return QuotaKey(auth.user_id)
    host = request.client.host if request.client else "anon"
    return QuotaKey(host)


def _check_quota(
    runtime: PhotoSearchRuntime,
    settings: Settings,
    tier: QuotaTier,
    key: QuotaKey,
    byok: EndpointId | None,
) -> None:
    if runtime.quota.consume(tier, key, _quota_limit(settings, tier)):
        return
    raise PhotoSearchRejection(
        429,
        "photo_search_quota_exhausted",
        "The photo-search quota for today is used up.",
        guidance=quota_guidance(byok),
    )


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
) -> JSONResponse:
    """Run the standalone vision pipeline and reply with a chat-shaped envelope."""
    runtime = _get_photo_runtime(request)
    byok = _byok_endpoint(request)
    authenticated = auth.user_id is not None and not is_anonymous_identity(
        auth.user_id, auth.user_type
    )
    try:
        image = _decode_image(body)
        tier = quota_tier_for(authenticated)
        settings = _get_settings_from_request(request)
        _check_quota(runtime, settings, tier, _quota_key(auth, request), byok)
    except PhotoSearchRejection as rejection:
        return _rejection_response(rejection)
    return await _run_pipeline(runtime, byok, image, body, request, authenticated)


async def _run_pipeline(
    runtime: PhotoSearchRuntime,
    byok: EndpointId | None,
    image: bytes,
    body: PhotoSearchBody,
    request: Request,
    authenticated: bool,
) -> JSONResponse:
    outcome = await run_photo_search(
        _supply(runtime, byok),
        runtime.catalog,
        [image],
        _gps(body),
        _locale(request),
        authenticated,
    )
    record_photo_search(outcome.signals)
    return JSONResponse(outcome.response.model_dump(exclude_none=True))


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
