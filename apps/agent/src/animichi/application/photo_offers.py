"""Sessionless candidate-offer namespace for photo confirmation (AGENT-1 #952).

SearchPhoto issues one :class:`PhotoOffer` per recognition turn; ConfirmPhotoOffer
consumes it through this port. The namespace is deliberately **sessionless** —
an offer is keyed by its own opaque ``offer_id`` and never by a Session
identifier — and stays a separate namespace from Session offers (TURN-4): a
photo offer becomes a Session offer only through a future explicit slice.

No FastAPI / PydanticAI import may appear in this module or any consumer of
it; the production adapter (``infrastructure.photo_offers``) is an in-memory
bounded store with TTL + cleanup.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

OfferQueryType = Literal["anime_screenshot", "real_world_photo", "vision_unavailable"]
OfferLayerHit = Literal["1", "2", "none"]


@dataclass(frozen=True)
class OfferCandidate:
    """One candidate shown to the user in a photo-search response."""

    id: str
    title: str
    bangumi_id: str | None = None


@dataclass(frozen=True)
class OfferSignals:
    """The telemetry-relevant facts of the search that produced the offer.

    Server-derived at issue time; a confirm replays these instead of trusting
    client-submitted signal values.
    """

    query_type: OfferQueryType
    gps_available: bool
    layer_hit: OfferLayerHit
    candidates_shown: int


@dataclass(frozen=True)
class PhotoOffer:
    """One server-issued candidate offer for a photo-search response."""

    offer_id: str
    candidates: tuple[OfferCandidate, ...]
    signals: OfferSignals
    expires_at: datetime


@dataclass(frozen=True)
class ConfirmedOffer:
    """A validated confirm: the offer's signals plus the chosen candidate."""

    signals: OfferSignals
    candidate: OfferCandidate | None


class PhotoOfferStore(Protocol):
    """Port: the sessionless candidate-offer namespace."""

    def put(self, offer: PhotoOffer) -> None: ...

    def get(self, offer_id: str) -> PhotoOffer | None: ...

    def confirm(self, offer_id: str, candidate_id: str | None) -> ConfirmedOffer | None:
        """Return the confirmed offer, or ``None`` when the offer id is unknown
        (or expired) or the candidate does not belong to the offer."""

    def cleanup(self, now: datetime) -> int:
        """Evict expired offers; returns how many were removed."""
