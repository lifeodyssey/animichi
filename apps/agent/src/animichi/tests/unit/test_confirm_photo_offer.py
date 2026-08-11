"""ConfirmPhotoOffer application-seam tests (AGENT-1 #952).

The confirm use case owns candidate confirmation through the sessionless
offer namespace: only a server-issued, unexpired offer with a matching
candidate confirms; unknown offers, wrong candidates, expired offers, and
Session-shaped references all reject.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from animichi.application.confirm_photo_offer import (
    PhotoOfferRejection,
)
from animichi.application.photo_offers import (
    OfferCandidate,
    OfferSignals,
    PhotoOffer,
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


def _store_with_offer(clock: FixedClock) -> tuple[InMemoryPhotoOfferStore, str]:
    store = InMemoryPhotoOfferStore(clock=clock)
    store.put(
        PhotoOffer(
            offer_id="offer-1",
            candidates=(OfferCandidate(id="c-1", title="君の名は。"),),
            signals=_SIGNALS,
            expires_at=clock() + timedelta(minutes=10),
        )
    )
    return store, "offer-1"


async def test_confirm_known_offer_with_matching_candidate() -> None:
    clock = FixedClock()
    store, offer_id = _store_with_offer(clock)
    result = make_confirm(store, clock)(offer_id, "c-1")
    assert result.signals == _SIGNALS
    assert result.candidate == OfferCandidate(id="c-1", title="君の名は。")


async def test_confirm_without_a_candidate_returns_signals_only() -> None:
    clock = FixedClock()
    store, offer_id = _store_with_offer(clock)
    result = make_confirm(store, clock)(offer_id, None)
    assert result.signals == _SIGNALS
    assert result.candidate is None


async def test_unknown_offer_is_rejected() -> None:
    clock = FixedClock()
    store, _ = _store_with_offer(clock)
    confirm = make_confirm(store, clock)
    with pytest.raises(PhotoOfferRejection) as excinfo:
        confirm("no-such-offer", None)
    assert excinfo.value.status_code == 404
    assert excinfo.value.code == "photo_offer_not_found"


async def test_candidate_outside_the_offer_is_rejected() -> None:
    clock = FixedClock()
    store, offer_id = _store_with_offer(clock)
    confirm = make_confirm(store, clock)
    with pytest.raises(PhotoOfferRejection):
        confirm(offer_id, "other-candidate")


async def test_expired_offer_is_rejected_and_cleaned_up() -> None:
    clock = FixedClock()
    store, offer_id = _store_with_offer(clock)
    clock.now = clock.now + timedelta(hours=1)
    confirm = make_confirm(store, clock)
    with pytest.raises(PhotoOfferRejection):
        confirm(offer_id, "c-1")
    assert store.get(offer_id) is None


async def test_session_shaped_reference_is_not_a_photo_offer() -> None:
    """TURN-4 separation: a Session offer id must never resolve in the
    sessionless photo namespace — a confirm can only name a photo offer."""
    clock = FixedClock()
    store, _ = _store_with_offer(clock)
    confirm = make_confirm(store, clock)
    with pytest.raises(PhotoOfferRejection):
        confirm("session-abc123", None)
    with pytest.raises(PhotoOfferRejection):
        confirm("sess-1", "c-1")


async def test_confirm_runs_the_cleanup_sweep_before_lookup() -> None:
    clock = FixedClock()
    store, offer_id = _store_with_offer(clock)
    store.put(
        PhotoOffer(
            offer_id="stale",
            candidates=(OfferCandidate(id="x", title="stale"),),
            signals=_SIGNALS,
            expires_at=clock() - timedelta(minutes=1),
        )
    )
    clock.now = clock.now + timedelta(minutes=2)
    result = make_confirm(store, clock)(offer_id, "c-1")
    assert result.candidate is not None
    assert store.get("stale") is None


async def test_confirmable_offer_issued_by_search_flow() -> None:
    """The full seam loop: SearchPhoto issues, ConfirmPhotoOffer confirms."""
    clock = FixedClock()
    store = InMemoryPhotoOfferStore(clock=clock)
    search, _ = make_search(offers=store, clock=clock)
    result = await search(command())
    confirm = make_confirm(store, clock)
    confirmed = confirm(result.offer_id, None)
    assert confirmed.signals == result.signals
