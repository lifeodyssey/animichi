"""Photo-search vision recognition via the main agent's multimodal input.

Replaces the standalone Gemini REST client + BYOK-canary router (SD-26
D1/D4/D5) with a single ``pydantic_ai.Agent`` run carrying ``BinaryContent``
images (#656, 2026-08-04). The recognition prompt no longer needs the D5
"report how many images you received" canary to catch an endpoint that
silently drops image parts: that detection required its own capability-eval
harness (deferred to S1, #656) and existed only because the old REST client
could not otherwise tell a genuine miss from a dropped image. Losing it is a
deliberate, documented scope reduction — see the PR description for #656.

BYOK vision *discovery* now lives entirely at ``POST /v1/byok/probe`` (#284
Task 5, ``agent/interfaces/routes/byok.py``), which already runs the same
"one image, one text prompt" round trip through ``pydantic_ai`` to tell the
BYOK settings panel whether a configured model accepts images. This module
does not duplicate that discovery step: it simply attempts the caller's BYOK
model first (when one was resolved for the request) and falls back to the
platform model on any call failure — the same "try, then fall back to
platform for this call" contract the old canary-based router used for a
runtime failure.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal

import httpx
import structlog
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.messages import BinaryContent, UserContent
from pydantic_ai.models import Model
from pydantic_ai.usage import RunUsage

logger = structlog.get_logger(__name__)

VisionProviderKind = Literal["byok", "platform"]

_PROMPT_TEMPLATE = (
    "You will receive one or more photos. Identify up to 4 anime SERIES "
    "titles this scene could be from (main series name only, no "
    "season/movie suffixes). If you don't recognize any anime in the "
    "photos, return an empty list. Reply in locale: {locale}."
)

# Same I/O-boundary failure shape the old router used (vision_supply_router,
# removed by #656): transport/timeout errors, OS-level connection errors, and
# pydantic-ai's own `AgentRunError` family (`ModelHTTPError` included) — all
# subclass `RuntimeError`. Deliberately excludes `ValueError`:
# `pydantic.ValidationError` is a `ValueError` subclass, and a genuine bug in
# our own request/response handling must still surface as a 500 rather than
# being silently treated as a fallback-worthy provider failure.
_RECOGNITION_FAILURES: tuple[type[Exception], ...] = (
    httpx.HTTPError,
    OSError,
    RuntimeError,
)


class RecognizedTitles(BaseModel):
    """Structured photo-recognition output."""

    candidate_titles: list[str] = Field(default_factory=list)


class VisionRecognitionFailed(Exception):
    """Raised when no model could complete a recognition turn at all — the
    BYOK attempt (if any) and the platform model are both exhausted."""


@dataclass(frozen=True)
class VisionCallResult:
    candidate_titles: list[str]
    provider_kind: VisionProviderKind
    usage: RunUsage


RecognizeCall = Callable[[], Awaitable[VisionCallResult]]


def _images_to_content(images: list[bytes]) -> list[UserContent]:
    return [
        BinaryContent(data=image, media_type=sniff_image_mime(image) or "image/jpeg")
        for image in images
    ]


async def _run_recognition(
    model: Model, images: list[bytes], locale: str
) -> tuple[list[str], RunUsage]:
    agent: Agent[None, RecognizedTitles] = Agent(
        model, output_type=RecognizedTitles, name="photo_vision"
    )
    prompt = _PROMPT_TEMPLATE.format(locale=locale)
    result = await agent.run([prompt, *_images_to_content(images)])
    return result.output.candidate_titles, result.usage


async def _try_byok(
    model: Model, images: list[bytes], locale: str
) -> VisionCallResult | None:
    """A failed BYOK call falls back to platform (by design, unchanged from
    the old router): a transient blip or a model that rejects the image part
    must not turn into a hard failure while the platform model is still
    available."""
    try:
        titles, usage = await _run_recognition(model, images, locale)
    except _RECOGNITION_FAILURES as exc:
        logger.warning("vision_byok_recognize_failed", error_type=type(exc).__name__)
        return None
    return VisionCallResult(titles, "byok", usage)


async def _recognize_platform(
    model: Model, images: list[bytes], locale: str
) -> VisionCallResult:
    """The final fallback: any failure here has nowhere left to go."""
    try:
        titles, usage = await _run_recognition(model, images, locale)
    except _RECOGNITION_FAILURES as exc:
        logger.warning(
            "vision_platform_recognize_failed", error_type=type(exc).__name__
        )
        raise VisionRecognitionFailed from exc
    return VisionCallResult(titles, "platform", usage)


async def recognize_photo(
    platform_model: Model,
    byok_model: Model | None,
    images: list[bytes],
    locale: str,
) -> VisionCallResult:
    """BYOK first (when supplied), platform as the fallback/default."""
    if byok_model is not None:
        result = await _try_byok(byok_model, images, locale)
        if result is not None:
            return result
    return await _recognize_platform(platform_model, images, locale)


def sniff_image_mime(image: bytes) -> str | None:
    """Strict magic-byte sniff; ``None`` when the bytes are not a supported
    image. Used both to validate an uploaded image's real type (the client's
    declared mime is never trusted, `agent/interfaces/routes/photo_search.py`)
    and to label the ``BinaryContent`` part sent to the model above."""
    if image.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image.startswith(b"RIFF") and image[8:12] == b"WEBP":
        return "image/webp"
    if image.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None
