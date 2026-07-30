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

import httpx
import structlog
from pydantic import BaseModel, Field
from pydantic_ai.usage import RunUsage

logger = structlog.get_logger(__name__)

logger = structlog.get_logger(__name__)

EndpointId = NewType("EndpointId", str)

# I/O-boundary failures a vision provider call may raise: transport/timeout,
# non-2xx status (auth failures included), and OS-level connection errors.
# Same tuple shape as CATALOG_FAILURES (agent/agents/catalog_failures.py):
# (APIError, OSError, RuntimeError) — swapping APIError for httpx.HTTPError
# because vision providers call httpx directly, unlike the catalog client
# which wraps httpx errors into APIError itself. Deliberately excludes
# ValueError: pydantic.ValidationError is a ValueError subclass, and a
# provider's own validation bug must still surface as a 500 rather than
# being silently treated as a fallback-worthy failure.
_VISION_CALL_FAILURES: tuple[type[Exception], ...] = (
    httpx.HTTPError,
    OSError,
    RuntimeError,
)

_AUTH_FAILURE_STATUSES = frozenset({401, 403})


def _is_auth_failure(exc: Exception) -> bool:
    """An auth-shaped failure (401/403) means a bad key, not a hiccup.

    Bound to httpx today even though ``VisionProvider`` is a Protocol — the
    only concrete providers are httpx-based (#502 review round 2). When
    #284 lands a non-HTTP provider, this should become a signal the
    provider itself can express (e.g. raising a typed auth-failure
    exception) rather than router-side status-code sniffing.

    Known gap (accepted, not blocking): Google's API family returns 400
    ``API_KEY_INVALID`` for a bad key, not 401 — that case is NOT
    demoted here. Fails toward safety (an endpoint that should be demoted
    stays live a little longer) rather than toward over-demotion.
    """
    return (
        isinstance(exc, httpx.HTTPStatusError)
        and exc.response.status_code in _AUTH_FAILURE_STATUSES
    )


class VisionProviderMisconfigured(Exception):
    """Raised by a provider that has no credential to attempt a call at all
    (e.g. an empty API key). Distinct from a call that ran and failed, so
    ops can tell "never configured" apart from "had a bad day" (#502)."""


class VisionRecognitionFailed(Exception):
    """Raised when the platform vision provider fails and there is no more
    fallback left to try (SD-19: carries no upstream-derived text)."""


# BYOK providers may also raise VisionProviderMisconfigured (defensive: a
# byok VisionProvider wired without a credential); folded into one tuple so
# ``_call_byok`` has a single except clause mypy can verify statically.
_BYOK_CALL_FAILURES: tuple[type[Exception], ...] = (
    VisionProviderMisconfigured,
    *_VISION_CALL_FAILURES,
)


VisionProviderKind = Literal["byok", "platform"]
QuotaTier = Literal["anon", "member"]
GuidancePremise = Literal["configure_vision_key", "switch_vision_endpoint"]


class VisionRecognition(BaseModel):
    """What the recognition prompt returned, canary count included (D5)."""

    reported_image_count: int
    candidate_titles: list[str] = Field(default_factory=list)
    usage: RunUsage | None = None


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
    usage: RunUsage


@dataclass
class VisionSupply:
    """The providers one photo-search request may draw on, canary applied."""

    platform: VisionProvider
    registry: VisionCapabilityRegistry
    byok: VisionProvider | None = None
    byok_endpoint: EndpointId | None = None

    def route(self, authenticated: bool) -> VisionRoute:
        return choose_vision_route(self.byok_endpoint, self.registry, authenticated)

    @staticmethod
    def _usage(recognition: VisionRecognition) -> RunUsage:
        return recognition.usage or RunUsage(requests=1)

    async def recognize(
        self, images: list[bytes], locale: str, authenticated: bool
    ) -> VisionCallResult:
        route = self.route(authenticated)
        if route.provider_kind == "byok":
            result = await self._recognize_byok(images, locale)
            if result is not None:
                return result
        recognition = await self._recognize_platform(images, locale)
        return VisionCallResult(
            recognition,
            "platform",
            route.provider_kind == "byok",
            self._usage(recognition),
        )

    async def _recognize_platform(
        self, images: list[bytes], locale: str
    ) -> VisionRecognition:
        """The final fallback: any failure here has nowhere left to go."""
        try:
            return await self.platform.recognize(images, locale)
        except VisionProviderMisconfigured as exc:
            logger.error("vision_platform_misconfigured", error_type=type(exc).__name__)
            raise VisionRecognitionFailed from exc
        except _VISION_CALL_FAILURES as exc:
            logger.warning(
                "vision_platform_recognize_failed", error_type=type(exc).__name__
            )
            raise VisionRecognitionFailed from exc

    async def _recognize_byok(
        self, images: list[bytes], locale: str
    ) -> VisionCallResult | None:
        """D5 canary: a wrong reported count demotes the endpoint mid-call."""
        if self.byok is None or self.byok_endpoint is None:
            return None
        endpoint = self.byok_endpoint
        recognition = await self._call_byok(self.byok, endpoint, images, locale)
        if recognition is None:
            return None
        if recognition.reported_image_count == len(images):
            return VisionCallResult(
                recognition, "byok", False, self._usage(recognition)
            )
        self.registry.mark(endpoint, False)
        return None

    async def _call_byok(
        self,
        provider: VisionProvider,
        endpoint: EndpointId,
        images: list[bytes],
        locale: str,
    ) -> VisionRecognition | None:
        """A failed BYOK call falls back to platform (by design). Only an
        auth-shaped failure demotes the endpoint like a canary mismatch does;
        a transient blip (timeout, 5xx, network hiccup) falls back for this
        call only, so one bad network moment doesn't permanently sideline an
        otherwise-working endpoint (#502)."""
        try:
            return await provider.recognize(images, locale)
        except _BYOK_CALL_FAILURES as exc:
            demoted = _is_auth_failure(exc)
            if demoted:
                self.registry.mark(endpoint, False)
            logger.warning(
                "vision_byok_recognize_failed",
                endpoint=endpoint,
                error_type=type(exc).__name__,
                demoted=demoted,
            )
            return None
