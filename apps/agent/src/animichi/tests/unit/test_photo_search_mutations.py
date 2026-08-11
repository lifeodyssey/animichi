"""Mutation proofs for SearchPhoto / ConfirmPhotoOffer (AGENT-1 #952).

Each test encodes a rule the card must own; deleting the rule turns the seam
red. The card's three named mutations:
- bypassing quota — SearchPhoto stops consuming the per-tier counter;
- accepting a wrong offer — ConfirmPhotoOffer drops the offer/candidate check;
- treating a Session offer as a photo offer — the confirm resolves a
  Session-shaped reference in the photo namespace.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from animichi.application.confirm_photo_offer import PhotoOfferRejection
from animichi.application.photo_offers import OfferCandidate, OfferSignals, PhotoOffer
from animichi.application.search_photo import (
    ModelPrices,
    PhotoSearchRejection,
    SearchPhotoPolicy,
)
from animichi.infrastructure.photo_offers import InMemoryPhotoOfferStore
from animichi.tests.unit.search_photo_fixtures import (
    FixedClock,
    command,
    make_confirm,
    make_search,
)

_SIGNALS = OfferSignals(
    query_type="anime_screenshot",
    gps_available=False,
    layer_hit="1",
    candidates_shown=1,
)


def _stored_offer(clock: FixedClock, store: InMemoryPhotoOfferStore) -> None:
    store.put(
        PhotoOffer(
            offer_id="offer-1",
            candidates=(OfferCandidate(id="c-1", title="君の名は。"),),
            signals=_SIGNALS,
            expires_at=clock() + timedelta(minutes=10),
        )
    )


async def test_bypassing_quota_never_succeeds_a_second_same_day_turn() -> None:
    """If quota consumption were deleted (or the counter bypassed), a second
    same-day turn would succeed — this must stay rejected."""
    search, _ = make_search(
        policy=SearchPhotoPolicy(
            quota_anon=1, quota_member=None, prices=ModelPrices(2.0, 2.0)
        )
    )
    first = await search(command())
    assert first.offer_id != ""
    with pytest.raises(PhotoSearchRejection) as excinfo:
        await search(command())
    assert excinfo.value.code == "photo_search_quota_exhausted"


async def test_accepting_a_wrong_offer_fails() -> None:
    """If the offer lookup were dropped (any offer_id "confirms"), a random
    id would succeed — it must reject as an unknown photo offer."""
    clock = FixedClock()
    store = InMemoryPhotoOfferStore(clock=clock)
    _stored_offer(clock, store)
    confirm = make_confirm(store, clock)
    with pytest.raises(PhotoOfferRejection):
        confirm("not-the-offer", "c-1")
    with pytest.raises(PhotoOfferRejection):
        confirm("offer-1", "not-the-candidate")


async def test_treating_a_session_offer_as_a_photo_offer_fails() -> None:
    """TURN-4 separation: Session offers live in a different namespace — a
    Session-shaped reference must never resolve as a photo offer, even when
    the photo namespace is otherwise healthy."""
    clock = FixedClock()
    store = InMemoryPhotoOfferStore(clock=clock)
    _stored_offer(clock, store)
    confirm = make_confirm(store, clock)
    with pytest.raises(PhotoOfferRejection):
        confirm("sess-1", None)
    with pytest.raises(PhotoOfferRejection):
        confirm("session_abc123", "c-1")
