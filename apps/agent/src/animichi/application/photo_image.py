"""Photo image validation policy (AGENT-1 #952).

The image limits, magic-byte sniffing, and the typed :class:`PhotoSearchRejection`
the SearchPhoto use case raises. Split out of ``application/search_photo`` to
keep that module under the repo's 300-line file budget; the route maps the
rejection to the wire envelope.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from typing import Literal

GuidancePremise = Literal["configure_vision_key", "switch_vision_endpoint"]

SUPPORTED_IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})

# 8 MiB image cap (matches the client-side pre-check and the contract's
# parse belt); base64 expands ceil(n/3)*4.
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_BASE64_CHARS = ((MAX_IMAGE_BYTES + 2) // 3) * 4


@dataclass(frozen=True)
class PhotoSearchRejection(Exception):
    """A typed refusal, mapped to the service error envelope by the route."""

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


def sniff_image_mime(image: bytes) -> str | None:
    """Strict magic-byte sniff; ``None`` when the bytes are not a supported
    image. Used both to validate an uploaded image's real type (the client's
    declared mime is never trusted) and to label the ``BinaryContent`` part
    sent to the model."""
    if image.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if _is_webp(image):
        return "image/webp"
    if image.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None


def _is_webp(image: bytes) -> bool:
    return image.startswith(b"RIFF") and image[8:12] == b"WEBP"


def decode_image(image_base64: str, mime_type: str) -> bytes:
    """Every rejecting guard runs before the quota slot is spent (#739): a
    request this turn is about to refuse anyway must never cost the caller
    their daily allowance."""
    if mime_type not in SUPPORTED_IMAGE_TYPES:
        raise PhotoSearchRejection(
            415, "unsupported_image_format", "This image format is not supported."
        )
    _reject_oversized(image_base64)
    return _validated_bytes(image_base64)


def _reject_oversized(image_base64: str) -> None:
    if len(image_base64) > MAX_IMAGE_BASE64_CHARS:
        raise PhotoSearchRejection(
            413, "image_too_large", "The image is larger than the 8 MB limit."
        )


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
