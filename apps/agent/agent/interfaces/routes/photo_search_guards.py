"""Photo-search request guards: image validation, budget, quota, BYOK login gate.

Split out of `photo_search.py` to keep that module under the repo's 300-line
file budget — these are the boundary checks that run before recognition
(`agent.agents.photo_vision`) is ever attempted.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from typing import Literal

from fastapi import Request
from fastapi.responses import JSONResponse

from agent.agents.photo_vision import sniff_image_mime
from agent.config.settings import Settings
from agent.infrastructure.observability.photo_search import QuotaKey, QuotaTier
from agent.interfaces.db_repos import usage_repo
from agent.interfaces.routes._deps import (
    TrustedAuthContext,
    _error_response,
    _get_settings_from_request,
    _has_byok_headers,
)
from agent.interfaces.routes.chat import BUDGET_EXHAUSTED_MESSAGE
from agent.interfaces.usage_metering import (
    ANON_BUDGET_EXHAUSTED_CODE,
    ANONYMOUS_USER_TYPE,
    anonymous_budget_verdict,
    is_anonymous_identity,
)

SUPPORTED_IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
GuidancePremise = Literal["configure_vision_key", "switch_vision_endpoint"]

# 8 MiB image cap (matches the client-side pre-check); base64 expands
# ceil(n/3)*4. The Field cap sits at 2x as a parse-time belt (422 for absurd
# payloads); the semantic limit below it returns the typed 413.
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_BASE64_CHARS = ((MAX_IMAGE_BYTES + 2) // 3) * 4

BYOK_REQUIRES_LOGIN_MESSAGE = "BYOKを使うにはログインが必要です。"


@dataclass(frozen=True)
class PhotoSearchRejection(Exception):
    """A typed rejection turned into the service error envelope."""

    status_code: int
    code: Literal[
        "unsupported_image_format",
        "invalid_image",
        "image_too_large",
        "photo_search_quota_exhausted",
        "invalid_request",
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


def _decode_image(image_base64: str, mime_type: str) -> bytes:
    if mime_type not in SUPPORTED_IMAGE_TYPES:
        raise PhotoSearchRejection(
            415, "unsupported_image_format", "This image format is not supported."
        )
    if len(image_base64) > MAX_IMAGE_BASE64_CHARS:
        raise PhotoSearchRejection(
            413, "image_too_large", "The image is larger than the 8 MB limit."
        )
    return _validated_bytes(image_base64)


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


def _quota_tier_for(authenticated: bool) -> QuotaTier:
    return "member" if authenticated else "anon"


def _quota_guidance(has_byok: bool) -> GuidancePremise:
    return "switch_vision_endpoint" if has_byok else "configure_vision_key"


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


def _check_quota(quota_ok: bool, has_byok: bool) -> None:
    """`quota_ok` is the caller's own `PhotoSearchQuota.consume(...)` result —
    this module only owns the guidance/rejection shape, not the counter."""
    if quota_ok:
        return
    raise PhotoSearchRejection(
        429,
        "photo_search_quota_exhausted",
        "The photo-search quota for today is used up.",
        guidance=_quota_guidance(has_byok),
    )


async def _budget_rejection(
    request: Request, auth: TrustedAuthContext
) -> JSONResponse | None:
    # Route through the canonical predicate rather than testing `user_type`
    # directly: a request carrying `X-User-Id` but no `X-User-Type` is an
    # identified caller, and a looser check here metered them into the anonymous
    # scope and could refuse them once the anon budget ran out. The edge sets
    # both headers together (`workers/edge/app.ts`), so this is defence in depth
    # rather than a reachable path — but the same concept having two different
    # answers in the codebase is how it stops being one.
    if auth.user_id is not None and not is_anonymous_identity(
        auth.user_id, auth.user_type
    ):
        return None
    settings = _get_settings_from_request(request)
    verdict = await anonymous_budget_verdict(
        usage_repo(request.app.state.db_client),
        budget_usd=settings.anon_daily_cost_budget_usd,
    )
    if not verdict.exhausted:
        return None
    return JSONResponse(
        status_code=403,
        content={
            "error": {
                "code": ANON_BUDGET_EXHAUSTED_CODE,
                "message": BUDGET_EXHAUSTED_MESSAGE,
                "action": "login",
            }
        },
    )


def _byok_login_rejection(
    auth: TrustedAuthContext, request: Request
) -> JSONResponse | None:
    """Reject anonymous BYOK presence before parsing its credential shape.

    Routes through `is_anonymous_identity` — the single canonical "is this
    caller anonymous" predicate (also used below by `_scope_user_type`'s
    sibling logic and by the route's own `authenticated` computation) —
    rather than a bare `user_type != ANONYMOUS_USER_TYPE` check. A literal
    check only catches a caller whose `X-User-Type` is exactly
    `"anonymous"`; an `anon_`-prefixed `X-User-Id` with a missing or
    mistyped `X-User-Type` is anonymous by the ID convention too, and
    `is_anonymous_identity` is what the rest of this module (and quota
    metering) already treats as ground truth. Without this, that same
    caller would clear the login gate here yet still resolve to the "anon"
    scope for billing — one request, two different identity verdicts, and
    the gap between them is a BYOK-vision bypass for anonymous callers.
    """
    if not is_anonymous_identity(auth.user_id, auth.user_type) or not _has_byok_headers(
        request
    ):
        return None
    return _error_response(
        "byok_requires_login", BYOK_REQUIRES_LOGIN_MESSAGE, status_code=403
    )


def _scope_user_type(auth: TrustedAuthContext) -> str | None:
    """Two different absences that a blanket `or "anonymous"` conflated.

    No `X-User-Id` means no identity was asserted at all — the anonymous tier.
    An `X-User-Id` with no `X-User-Type` is an identified caller whose type
    header went missing; `scope_for_identity` resolves that against the user-id
    convention, so it must be passed through rather than coerced, or their
    spend lands in the anon scope.
    """
    return auth.user_type if auth.user_id is not None else ANONYMOUS_USER_TYPE
