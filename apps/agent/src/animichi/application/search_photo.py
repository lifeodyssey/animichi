"""SearchPhoto use case (AGENT-1 #952) — owns the photo-search turn.

The use case owns image validation (``application.photo_image``), the
per-tier quota, BYOK client cleanup, recognition (through the injected vision
adapter), the resolve/degrade pipeline (through the injected pipeline port),
candidate-offer issuance into the sessionless offer namespace, and usage
recording. The FastAPI boundary only parses the generated request DTO and
maps the neutral result (``application.photo_search_envelope``) back to wire
shapes.

No FastAPI / PydanticAI import may appear in this module; adapters in
``agents/`` implement the vision and pipeline ports, ``interfaces/routes``
resolves BYOK and maps errors.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol

import structlog

from animichi.application.identity import is_anonymous_identity
from animichi.application.model_turn_port import ModelTurnUsage
from animichi.application.photo_image import (
    PhotoSearchRejection,
    decode_image,
)
from animichi.application.photo_offers import (
    OfferCandidate,
    OfferSignals,
    PhotoOffer,
    PhotoOfferStore,
)
from animichi.application.photo_search_envelope import (
    PhotoCandidate,
    PhotoResults,
    PhotoSearchEnvelope,
    PipelineOutcome,
)
from animichi.domain.ports import UsageMeter

logger = structlog.get_logger(__name__)

QuotaTier = Literal["anon", "member"]
VisionProviderKind = Literal["byok", "platform"]

#: How long an issued candidate offer stays confirmable (namespace TTL).
PHOTO_OFFER_TTL = timedelta(minutes=10)

#: Usage recording is best-effort: a metering failure must never fail the
#: search the user actually got.
_METER_ERRORS: tuple[type[Exception], ...] = (Exception,)


@dataclass(frozen=True)
class PhotoIdentity:
    """The edge-forwarded identity headers, nothing more."""

    user_id: str | None
    user_type: str | None


@dataclass(frozen=True)
class GpsPoint:
    lat: float
    lng: float


@dataclass(frozen=True)
class ModelPrices:
    """Per-million-token prices; configuration, never literals in the logic."""

    input_usd_per_mtok: float
    output_usd_per_mtok: float


@dataclass(frozen=True)
class SearchPhotoPolicy:
    """Photo-search policy cells, consumed from ONE source (settings)."""

    quota_anon: int | None
    quota_member: int | None
    prices: ModelPrices


@dataclass(frozen=True)
class PhotoVisionResult:
    """Neutral recognition outcome (the adapter maps PydanticAI types away)."""

    candidate_titles: list[str]
    provider_kind: VisionProviderKind
    usage: ModelTurnUsage


RecognizePhoto = Callable[[], Awaitable[PhotoVisionResult]]

PhotoSearchPipelineCall = Callable[
    [RecognizePhoto, GpsPoint | None], Awaitable[PipelineOutcome]
]


class ByokSession(Protocol):
    """The per-request BYOK model carrier the route built; the use case owns
    its cleanup and closes it on every exit path."""

    async def close(self) -> None: ...


class PhotoQuota(Protocol):
    """Per-day, per-tier photo-search counter (in-process, best-effort)."""

    def consume(self, tier: QuotaTier, key: str, limit: int | None) -> bool: ...


@dataclass(frozen=True)
class SearchPhotoCommand:
    """One photo-search turn, fully parsed by the boundary."""

    image_base64: str
    mime_type: str
    gps: GpsPoint | None
    locale: str
    identity: PhotoIdentity
    quota_key: str
    has_byok: bool


@dataclass(frozen=True)
class SearchPhotoResult:
    """The use case's outcome; the route maps it to the wire response."""

    offer_id: str
    envelope: PhotoSearchEnvelope
    signals: OfferSignals
    tier: QuotaTier
    usage: ModelTurnUsage | None = None
    provider_kind: VisionProviderKind | None = None


class SearchPhoto:
    """Use case: one photo-search turn, in ordered policy steps."""

    def __init__(
        self,
        *,
        vision: Callable[[list[bytes], str], Awaitable[PhotoVisionResult]],
        pipeline: PhotoSearchPipelineCall,
        offers: PhotoOfferStore,
        quota: PhotoQuota,
        policy: SearchPhotoPolicy,
        usage_repo: UsageMeter | None = None,
        byok: ByokSession | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._vision = vision
        self._pipeline = pipeline
        self._offers = offers
        self._quota = quota
        self._policy = policy
        self._usage_repo = usage_repo
        self._byok = byok
        self._clock = clock

    async def __call__(self, command: SearchPhotoCommand) -> SearchPhotoResult:
        try:
            image = decode_image(command.image_base64, command.mime_type)
            tier = _tier_for(command.identity)
            if not self._quota.consume(tier, command.quota_key, self._limit(tier)):
                raise _quota_rejection(command.has_byok)
            recognize = self._recognize(image, command.locale)
            outcome = await self._pipeline(recognize, command.gps)
        finally:
            await self._close_byok()
        offer_id = self._issue_offer(outcome)
        await self._record_usage(outcome, command.identity)
        return SearchPhotoResult(
            offer_id=offer_id,
            envelope=outcome.envelope,
            signals=outcome.signals,
            tier=tier,
            usage=outcome.usage,
            provider_kind=outcome.provider_kind,
        )

    def _limit(self, tier: QuotaTier) -> int | None:
        return (
            self._policy.quota_member if tier == "member" else self._policy.quota_anon
        )

    def _recognize(self, image: bytes, locale: str) -> RecognizePhoto:
        async def call() -> PhotoVisionResult:
            return await self._vision([image], locale)

        return call

    def _issue_offer(self, outcome: PipelineOutcome) -> str:
        candidates = tuple(_offer_candidates(outcome.envelope))
        offer = PhotoOffer(
            offer_id=uuid.uuid4().hex,
            candidates=candidates,
            signals=outcome.signals,
            expires_at=self._clock() + PHOTO_OFFER_TTL,
        )
        self._offers.put(offer)
        return offer.offer_id

    async def _record_usage(
        self, outcome: PipelineOutcome, identity: PhotoIdentity
    ) -> None:
        if self._usage_repo is None or outcome.usage is None:
            return
        try:
            await self._usage_repo.accumulate_usage(
                usage_date=self._clock().date(),
                scope=_usage_scope(identity, outcome.provider_kind),
                requests=outcome.usage.requests,
                input_tokens=outcome.usage.prompt_tokens,
                output_tokens=outcome.usage.completion_tokens,
                cost_usd=_usage_cost(outcome, self._policy.prices),
            )
        except _METER_ERRORS:
            logger.warning("photo_search_usage_record_failed", exc_info=True)

    async def _close_byok(self) -> None:
        if self._byok is not None:
            await self._byok.close()


def _offer_candidates(envelope: PhotoSearchEnvelope) -> list[OfferCandidate]:
    if envelope.data.results is not None:
        return _candidates_from_rows(envelope.data.results)
    return _candidates_from_offers(envelope.data.candidates)


def _candidates_from_rows(results: PhotoResults) -> list[OfferCandidate]:
    return [
        OfferCandidate(id=point.id, title=point.title, bangumi_id=point.bangumi_id)
        for point in results.rows
    ]


def _candidates_from_offers(
    candidates: tuple[PhotoCandidate, ...],
) -> list[OfferCandidate]:
    return [
        OfferCandidate(
            id=candidate.id, title=candidate.title, bangumi_id=candidate.bangumi_id
        )
        for candidate in candidates
    ]


def _usage_scope(
    identity: PhotoIdentity, provider_kind: VisionProviderKind | None
) -> str:
    if provider_kind == "byok":
        return "byok"
    if identity.user_id is None or is_anonymous_identity(
        identity.user_id, identity.user_type
    ):
        return "anon"
    return "user"


def _usage_cost(outcome: PipelineOutcome, prices: ModelPrices) -> float:
    usage = outcome.usage
    if usage is None:
        return 0.0
    if outcome.provider_kind == "byok":
        return 0.0
    input_usd = usage.prompt_tokens * prices.input_usd_per_mtok
    output_usd = usage.completion_tokens * prices.output_usd_per_mtok
    return (input_usd + output_usd) / 1_000_000


def _tier_for(identity: PhotoIdentity) -> QuotaTier:
    authenticated = identity.user_id is not None and not is_anonymous_identity(
        identity.user_id, identity.user_type
    )
    return "member" if authenticated else "anon"


def _quota_rejection(has_byok: bool) -> PhotoSearchRejection:
    return PhotoSearchRejection(
        429,
        "photo_search_quota_exhausted",
        "The photo-search quota for today is used up.",
        guidance="switch_vision_endpoint" if has_byok else "configure_vision_key",
    )
