"""Vision-supply decision tree (SD-26 D4) and runtime canary (D5).

Phase 1 keeps the vision call standalone (SD-26 D1): recognition never joins
the main tool loop. A BYOK key serves vision only after it has been probed
``vision_capable``; every other premise (BYOK without vision, no BYOK) falls
back to platform Gemini. Text-only self-hosted endpoints are never penalised:
their chat path is untouched and vision silently rides the platform key.
Embedding calls are outside this tree and always use the system key.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, NewType, Protocol

from pydantic import BaseModel, Field

EndpointId = NewType("EndpointId", str)

VisionProviderKind = Literal["byok", "platform"]
QuotaTier = Literal["anon", "member"]
GuidancePremise = Literal["configure_vision_key", "switch_vision_endpoint"]


class VisionRecognition(BaseModel):
    """What the recognition prompt returned, canary count included (D5)."""

    reported_image_count: int
    candidate_titles: list[str] = Field(default_factory=list)


class VisionProvider(Protocol):
    """A model endpoint that can run the standalone recognition prompt."""

    async def recognize(
        self, images: list[bytes], locale: str
    ) -> VisionRecognition: ...


class VisionCapabilityRegistry:
    """Mutable per-endpoint ``vision_capable`` flags updated by the canary."""

    def __init__(self) -> None:
        self._flags: dict[EndpointId, bool] = {}

    def is_vision_capable(self, endpoint: EndpointId) -> bool:
        return self._flags.get(endpoint, False)

    def mark(self, endpoint: EndpointId, capable: bool) -> None:
        self._flags[endpoint] = capable


@dataclass(frozen=True)
class VisionRoute:
    provider_kind: VisionProviderKind
    quota_tier: QuotaTier


def quota_tier_for(authenticated: bool) -> QuotaTier:
    return "member" if authenticated else "anon"


def choose_vision_route(
    byok_endpoint: EndpointId | None,
    registry: VisionCapabilityRegistry,
    authenticated: bool,
) -> VisionRoute:
    """D4: BYOK serves vision only when probed capable; otherwise platform."""
    tier = quota_tier_for(authenticated)
    if byok_endpoint is not None and registry.is_vision_capable(byok_endpoint):
        return VisionRoute(provider_kind="byok", quota_tier=tier)
    return VisionRoute(provider_kind="platform", quota_tier=tier)


def quota_guidance(byok_endpoint: EndpointId | None) -> GuidancePremise:
    """Exhausted-quota copy branches by premise (D4 guidance)."""
    if byok_endpoint is None:
        return "configure_vision_key"
    return "switch_vision_endpoint"


@dataclass(frozen=True)
class VisionCallResult:
    recognition: VisionRecognition
    provider_kind: VisionProviderKind
    fell_back_to_platform: bool


@dataclass
class VisionSupply:
    """The providers one photo-search request may draw on, canary applied."""

    platform: VisionProvider
    registry: VisionCapabilityRegistry
    byok: VisionProvider | None = None
    byok_endpoint: EndpointId | None = None

    def route(self, authenticated: bool) -> VisionRoute:
        return choose_vision_route(self.byok_endpoint, self.registry, authenticated)

    async def recognize(
        self, images: list[bytes], locale: str, authenticated: bool
    ) -> VisionCallResult:
        route = self.route(authenticated)
        if route.provider_kind == "byok":
            result = await self._recognize_byok(images, locale)
            if result is not None:
                return result
        recognition = await self.platform.recognize(images, locale)
        return VisionCallResult(recognition, "platform", route.provider_kind == "byok")

    async def _recognize_byok(
        self, images: list[bytes], locale: str
    ) -> VisionCallResult | None:
        """D5 canary: a wrong reported count demotes the endpoint mid-call."""
        if self.byok is None or self.byok_endpoint is None:
            return None
        recognition = await self.byok.recognize(images, locale)
        if recognition.reported_image_count == len(images):
            return VisionCallResult(recognition, "byok", False)
        self.registry.mark(self.byok_endpoint, False)
        return None
