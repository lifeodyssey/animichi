"""Photo-search request guards: image validation and the per-use tier quota.

Split out of `photo_search.py` to keep that module under the repo's 300-line
file budget — these are the boundary checks that run before recognition
(`animichi.agents.photo_vision`) is ever attempted.

The anonymous budget breaker, the BYOK login gate, and identity→payer mapping
are not duplicated here: every photo-search request passes through
:class:`TurnAdmission` (`application.turn_admission`) first, exactly like the
chat boundary.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from typing import Literal

from fastapi import Request
from fastapi.responses import JSONResponse

from animichi.agents.photo_vision import sniff_image_mime
from animichi.config.settings import Settings
from animichi.infrastructure.observability.photo_search import QuotaKey, QuotaTier
from animichi.interfaces.routes._deps import (
    TrustedAuthContext,
    _error_response,
)
from animichi.interfaces.usage_metering import ANONYMOUS_USER_TYPE

SUPPORTED_IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
GuidancePremise = Literal["configure_vision_key", "switch_vision_endpoint"]

# 8 MiB image cap (matches the client-side pre-check); base64 expands
# ceil(n/3)*4. The Field cap sits at 2x as a parse-time belt (422 for absurd
# payloads); the semantic limit below it returns the typed 413.
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_BASE64_CHARS = ((MAX_IMAGE_BYTES + 2) // 3) * 4


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
        "turn_lease_lost",
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


def _quota_tier_for(is_authenticated: bool) -> QuotaTier:
    return "member" if is_authenticated else "anon"


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


def _scope_user_type(auth: TrustedAuthContext) -> str | None:
    """Two different absences that a blanket `or "anonymous"` conflated.

    No `X-User-Id` means no identity was asserted at all — the anonymous tier.
    An `X-User-Id` with no `X-User-Type` is an identified caller whose type
    header went missing; `scope_for_identity` resolves that against the user-id
    convention, so it must be passed through rather than coerced, or their
    spend lands in the anon scope.
    """
    return auth.user_type if auth.user_id is not None else ANONYMOUS_USER_TYPE
