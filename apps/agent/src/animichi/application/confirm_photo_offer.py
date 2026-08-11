"""ConfirmPhotoOffer use case (AGENT-1 #952) — owns candidate confirmation.

The use case validates a confirm against the sessionless candidate-offer
namespace: the offer id must exist (and be unexpired) and the candidate must
belong to that offer. It also runs the demand-driven cleanup sweep before
every lookup, mirroring the campaign's "reconcile before the next observable
request" pattern. A confirm never carries Session identifiers — the offer
namespace is deliberately separate from Session offers (TURN-4) — so a
Session-shaped reference is simply an unknown offer id here.

No FastAPI / PydanticAI import may appear in this module.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from animichi.application.photo_offers import (
    OfferCandidate,
    OfferSignals,
    PhotoOfferStore,
)


@dataclass(frozen=True)
class PhotoOfferRejection(Exception):
    """A typed confirm refusal, mapped to the service error envelope."""

    status_code: int
    code: Literal["photo_offer_not_found", "photo_offer_candidate_mismatch"]
    message: str


@dataclass(frozen=True)
class ConfirmPhotoOfferResult:
    """A validated confirmation: server-derived signals + chosen candidate."""

    signals: OfferSignals
    candidate: OfferCandidate | None


class ConfirmPhotoOffer:
    """Use case: confirm one candidate of one server-issued photo offer."""

    def __init__(
        self,
        *,
        offers: PhotoOfferStore,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._offers = offers
        self._clock = clock

    def __call__(
        self, offer_id: str, candidate_id: str | None
    ) -> ConfirmPhotoOfferResult:
        self._offers.cleanup(self._clock())
        return _confirm_or_raise(self._offers, offer_id, candidate_id)


def _confirm_or_raise(
    offers: PhotoOfferStore, offer_id: str, candidate_id: str | None
) -> ConfirmPhotoOfferResult:
    confirmed = offers.confirm(offer_id, candidate_id)
    if confirmed is None:
        raise PhotoOfferRejection(
            404, "photo_offer_not_found", "This photo offer is unknown."
        )
    return ConfirmPhotoOfferResult(
        signals=confirmed.signals, candidate=confirmed.candidate
    )
