"""In-memory sessionless photo-offer store (AGENT-1 #952).

Bounded namespace: offers expire after a TTL and the store also caps the
total number of live offers, evicting the oldest when full. In-process only
(mirroring the D6 photo quota's best-effort, restart-reset semantics); a
shared store is a later ops decision.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from animichi.application.photo_offers import (
    ConfirmedOffer,
    OfferCandidate,
    PhotoOffer,
)

DEFAULT_OFFER_TTL = timedelta(minutes=10)
DEFAULT_MAX_OFFERS = 1_000


class InMemoryPhotoOfferStore:
    """Bounded TTL offer namespace; mockable clock for tests."""

    def __init__(
        self,
        *,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        ttl: timedelta = DEFAULT_OFFER_TTL,
        max_offers: int = DEFAULT_MAX_OFFERS,
    ) -> None:
        self._clock = clock
        self._ttl = ttl
        self._max_offers = max_offers
        self._offers: dict[str, PhotoOffer] = {}

    def put(self, offer: PhotoOffer) -> None:
        self._offers[offer.offer_id] = offer
        self._evict_over_cap()

    def get(self, offer_id: str) -> PhotoOffer | None:
        offer = self._offers.get(offer_id)
        if offer is None:
            return None
        if offer.expires_at <= self._clock():
            self._offers.pop(offer_id, None)
            return None
        return offer

    def confirm(self, offer_id: str, candidate_id: str | None) -> ConfirmedOffer | None:
        offer = self.get(offer_id)
        if offer is None:
            return None
        if candidate_id is not None:
            candidate = _find(offer.candidates, candidate_id)
            if candidate is None:
                return None
            return ConfirmedOffer(signals=offer.signals, candidate=candidate)
        return ConfirmedOffer(signals=offer.signals, candidate=None)

    def cleanup(self, now: datetime) -> int:
        expired = [
            offer_id
            for offer_id, offer in self._offers.items()
            if offer.expires_at <= now
        ]
        for offer_id in expired:
            self._offers.pop(offer_id, None)
        return len(expired)

    def _evict_over_cap(self) -> None:
        overflow = len(self._offers) - self._max_offers
        if overflow <= 0:
            return
        for offer_id in sorted(
            self._offers, key=lambda key: self._offers[key].expires_at
        )[:overflow]:
            self._offers.pop(offer_id, None)


def _find(
    candidates: tuple[OfferCandidate, ...], candidate_id: str
) -> OfferCandidate | None:
    for candidate in candidates:
        if candidate.id == candidate_id:
            return candidate
    return None
