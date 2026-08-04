"""Photo-search phase 1 boundary: ``POST /v1/photo-search`` (+ confirm ping).

Anonymous requests are allowed (metered on the anon tier); the Worker edge
still owns real auth, and this route only reads the trusted headers.

Recognition itself rides the main agent's multimodal input (``BinaryContent``,
`agent.agents.photo_vision`) instead of a standalone Gemini REST client + a
BYOK-canary router (#656) — this route's own job is unchanged: decode/validate
the upload, enforce budget/quota (`photo_search_guards`), resolve a BYOK model
from the real ``X-BYOK-*`` headers (mirroring `agent.interfaces.routes.chat`),
and hand a bound recognition closure to `agent.agents.photo_search.run_photo_search`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Annotated, Literal, cast

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from pydantic_ai.models import Model

from agent.agents.base import get_default_model
from agent.agents.byok_models import ByokError, ByokModel, build_byok_model
from agent.agents.photo_search import GpsPoint, PhotoSearchResponse, run_photo_search
from agent.agents.photo_vision import RecognizeCall, VisionCallResult, recognize_photo
from agent.clients.catalog_client import CatalogClient, CatalogClientProtocol
from agent.config.settings import Settings
from agent.infrastructure.observability.photo_search import (
    ClientQueryType,
    LayerHit,
    PhotoSearchQuota,
    PhotoSearchSignals,
    record_photo_search,
)
from agent.interfaces.db_repos import usage_repo
from agent.interfaces.public_api import record_attributed_usage
from agent.interfaces.routes._deps import (
    TrustedAuthContext,
    _get_byok_credential,
    _get_settings_from_request,
    _get_trusted_auth_context,
    _has_byok_headers,
)
from agent.interfaces.routes.photo_search_guards import (
    MAX_IMAGE_BASE64_CHARS,
    PhotoSearchRejection,
    _budget_rejection,
    _byok_login_rejection,
    _check_quota,
    _decode_image,
    _quota_key,
    _quota_limit,
    _quota_tier_for,
    _rejection_response,
    _scope_user_type,
)
from agent.interfaces.usage_metering import UsagePrices, is_anonymous_identity

__all__ = ["MAX_IMAGE_BASE64_CHARS", "PhotoSearchRuntime", "build_photo_search_runtime"]

router = APIRouter(prefix="/v1", tags=["photo-search"])

Locale = Literal["ja", "zh", "en"]


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

    platform_model: Model
    catalog: CatalogClientProtocol
    quota: PhotoSearchQuota = field(
        default_factory=lambda: PhotoSearchQuota(clock=lambda: datetime.now(UTC))
    )


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


async def _resolve_byok_model(request: Request) -> ByokModel | None:
    """Parse and build the per-request guarded model, same contract as
    `agent.interfaces.routes.chat._resolve_byok_model`. The caller MUST
    `await .client.aclose()` once the turn is over."""
    byok = _get_byok_credential(request)
    if byok is None:
        return None
    try:
        return await build_byok_model(byok)
    except ByokError as exc:
        raise PhotoSearchRejection(400, "invalid_request", exc.message) from exc
    except Exception as exc:
        raise PhotoSearchRejection(
            400, "invalid_request", "Unable to construct the BYOK model."
        ) from exc


def _consume_quota(
    runtime: PhotoSearchRuntime,
    request: Request,
    auth: TrustedAuthContext,
    authenticated: bool,
) -> None:
    settings = _get_settings_from_request(request)
    tier = _quota_tier_for(authenticated)
    quota_ok = runtime.quota.consume(
        tier, _quota_key(auth, request), _quota_limit(settings, tier)
    )
    _check_quota(quota_ok, _has_byok_headers(request))


async def _prepare_turn(
    runtime: PhotoSearchRuntime,
    request: Request,
    auth: TrustedAuthContext,
    body: PhotoSearchBody,
    authenticated: bool,
) -> tuple[bytes, ByokModel | None]:
    """Every rejecting guard — image validation, then BYOK resolution — runs
    before the quota slot is spent (#739 review): a request this turn is
    about to refuse anyway must never cost the caller their daily allowance.
    Quota is the last check because it is the only one with no rejection
    reason left to discover once it passes."""
    image = _decode_image(body.image_base64, body.mime_type)
    byok_model = await _resolve_byok_model(request)
    try:
        _consume_quota(runtime, request, auth, authenticated)
    except PhotoSearchRejection:
        if byok_model is not None:
            await byok_model.client.aclose()
        raise
    return image, byok_model


def _recognize_call(
    runtime: PhotoSearchRuntime,
    byok_model: Model | None,
    images: list[bytes],
    locale: str,
) -> RecognizeCall:
    async def call() -> VisionCallResult:
        return await recognize_photo(runtime.platform_model, byok_model, images, locale)

    return call


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
    authenticated = auth.user_id is not None and not is_anonymous_identity(
        auth.user_id, auth.user_type
    )
    login_rejection = _byok_login_rejection(auth, request)
    if login_rejection is not None:
        return login_rejection
    # The budget check runs before the image is decoded. It needs only `auth`,
    # and a breaker that fires after the work it is meant to prevent is most of
    # a breaker that does not work. The visible consequence: a caller who is both
    # over budget and sending a malformed image now gets 403 rather than 400 —
    # the correct precedence, since being over budget is the reason we are not
    # looking at their image at all.
    budget_rejection = await _budget_rejection(request, auth)
    if budget_rejection is not None:
        return budget_rejection
    try:
        image, byok_model = await _prepare_turn(
            runtime, request, auth, body, authenticated
        )
    except PhotoSearchRejection as rejection:
        return _rejection_response(rejection)
    return await _run_pipeline(runtime, byok_model, image, body, request, auth)


async def _run_pipeline(
    runtime: PhotoSearchRuntime,
    byok_model: ByokModel | None,
    image: bytes,
    body: PhotoSearchBody,
    request: Request,
    auth: TrustedAuthContext,
) -> JSONResponse:
    recognize = _recognize_call(
        runtime,
        byok_model.model if byok_model is not None else None,
        [image],
        _locale(request),
    )
    try:
        outcome = await run_photo_search(recognize, runtime.catalog, _gps(body))
    finally:
        if byok_model is not None:
            await byok_model.client.aclose()
    record_photo_search(outcome.signals)
    if outcome.usage is not None:
        settings = _get_settings_from_request(request)
        await record_attributed_usage(
            usage_repo(request.app.state.db_client),
            outcome.usage,
            auth.user_id,
            _scope_user_type(auth),
            UsagePrices(
                input_usd_per_mtok=settings.model_input_cost_per_mtok_usd,
                output_usd_per_mtok=settings.model_output_cost_per_mtok_usd,
            ),
        )
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
