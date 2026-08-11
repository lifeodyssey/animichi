"""In-memory sessionless photo-offer store tests (AGENT-1 #952).

Bounded namespace: TTL expiry, demand-driven cleanup, and a hard cap that
evicts the oldest offers. All timing is mock-clock driven.
"""

from __future__ import annotations

from datetime import timedelta

from animichi.application.photo_offers import (
    OfferCandidate,
    OfferSignals,
    PhotoOffer,
)
from animichi.infrastructure.photo_offers import InMemoryPhotoOfferStore
from animichi.tests.unit.search_photo_fixtures import FixedClock

_SIGNALS = OfferSignals(
    query_type="anime_screenshot", gps_available=True, layer_hit="1", candidates_shown=1
)


def _offer(offer_id: str, expires_in: timedelta, clock: FixedClock) -> PhotoOffer:
    return PhotoOffer(
        offer_id=offer_id,
        candidates=(OfferCandidate(id=f"{offer_id}-c", title=offer_id),),
        signals=_SIGNALS,
        expires_at=clock() + expires_in,
    )


def _store(max_offers: int = 10) -> tuple[InMemoryPhotoOfferStore, FixedClock]:
    clock = FixedClock()
    return InMemoryPhotoOfferStore(clock=clock, max_offers=max_offers), clock


def test_put_get_roundtrip() -> None:
    store, clock = _store()
    store.put(_offer("o-1", timedelta(minutes=10), clock))
    offer = store.get("o-1")
    assert offer is not None
    assert offer.offer_id == "o-1"
    assert offer.candidates[0].id == "o-1-c"


def test_get_returns_none_and_evicts_an_expired_offer() -> None:
    store, clock = _store()
    store.put(_offer("o-1", timedelta(minutes=-1), clock))
    assert store.get("o-1") is None
    assert store.get("o-1") is None  # already evicted, still missing


def test_confirm_matches_the_candidate_within_the_offer() -> None:
    store, clock = _store()
    store.put(_offer("o-1", timedelta(minutes=10), clock))
    confirmed = store.confirm("o-1", "o-1-c")
    assert confirmed is not None
    assert confirmed.candidate == OfferCandidate(id="o-1-c", title="o-1")
    assert store.confirm("o-1", "wrong-candidate") is None


def test_confirm_without_candidate_returns_signals_only() -> None:
    store, clock = _store()
    store.put(_offer("o-1", timedelta(minutes=10), clock))
    confirmed = store.confirm("o-1", None)
    assert confirmed is not None
    assert confirmed.candidate is None
    assert confirmed.signals == _SIGNALS


def test_confirm_of_unknown_or_expired_offer_is_none() -> None:
    store, clock = _store()
    store.put(_offer("o-1", timedelta(minutes=-1), clock))
    assert store.confirm("missing", None) is None
    assert store.confirm("o-1", None) is None


def test_cleanup_removes_only_expired_offers() -> None:
    store, clock = _store()
    store.put(_offer("fresh", timedelta(minutes=10), clock))
    store.put(_offer("stale", timedelta(minutes=-5), clock))
    store.put(_offer("staler", timedelta(seconds=-1), clock))
    assert store.cleanup(clock()) == 2
    assert store.get("fresh") is not None
    assert store.get("stale") is None


def test_cleanup_uses_the_passed_instant() -> None:
    store, clock = _store()
    store.put(_offer("o-1", timedelta(minutes=10), clock))
    later = clock() + timedelta(minutes=11)
    assert store.cleanup(later) == 1


def test_max_offers_evicts_the_oldest_offer() -> None:
    store, clock = _store(max_offers=2)
    store.put(_offer("oldest", timedelta(minutes=5), clock))
    store.put(_offer("middle", timedelta(minutes=10), clock))
    store.put(_offer("newest", timedelta(minutes=15), clock))
    assert store.get("oldest") is None
    assert store.get("middle") is not None
    assert store.get("newest") is not None
