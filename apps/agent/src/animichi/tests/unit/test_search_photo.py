"""SearchPhoto application-seam tests (AGENT-1 #952).

The seam owns image validation, the per-tier quota, offer issuance into the
sessionless namespace, and the anonymous/member tier mapping. Every rejecting
guard must run before the quota slot is spent (#739).
"""

from __future__ import annotations

import base64
from datetime import timedelta

import pytest

from animichi.application.photo_image import (
    MAX_IMAGE_BASE64_CHARS,
    PhotoSearchRejection,
)
from animichi.application.photo_offers import OfferSignals
from animichi.application.search_photo import (
    ModelPrices,
    SearchPhotoPolicy,
)
from animichi.infrastructure.photo_offers import InMemoryPhotoOfferStore
from animichi.tests.unit.search_photo_fixtures import (
    FixedClock,
    command,
    make_search,
)

_ANON = {"user_id": "anon_0123456789abcdef0123456789abcdef", "user_type": "anonymous"}
_PRICES = ModelPrices(2.0, 2.0)


def _policy(anon: int | None = None, member: int | None = None) -> SearchPhotoPolicy:
    return SearchPhotoPolicy(quota_anon=anon, quota_member=member, prices=_PRICES)


async def test_unsupported_mime_type_is_a_typed_415() -> None:
    search, _ = make_search()
    with pytest.raises(PhotoSearchRejection) as excinfo:
        await search(command(mime="image/gif"))
    rejection = excinfo.value
    assert rejection.status_code == 415
    assert rejection.code == "unsupported_image_format"


async def test_undecodable_image_is_a_422() -> None:
    search, _ = make_search()
    with pytest.raises(PhotoSearchRejection) as excinfo:
        await search(command(image_base64="?not-base64?"))
    assert excinfo.value.status_code == 422
    assert excinfo.value.code == "invalid_image"


async def test_labelled_jpeg_with_non_image_bytes_is_a_415() -> None:
    search, _ = make_search()
    with pytest.raises(PhotoSearchRejection) as excinfo:
        await search(command(image=b"not-an-image"))
    assert excinfo.value.status_code == 415
    assert excinfo.value.code == "unsupported_image_format"


async def test_oversized_image_is_a_typed_413() -> None:
    search, _ = make_search()
    oversized = base64.b64encode(b"\xff\xd8\xff" + b"x" * MAX_IMAGE_BASE64_CHARS)
    with pytest.raises(PhotoSearchRejection) as excinfo:
        await search(command(image=oversized))
    assert excinfo.value.status_code == 413
    assert excinfo.value.code == "image_too_large"


async def test_rejecting_guards_never_spend_the_quota_slot() -> None:
    """#739: a request the seam is about to refuse must not cost the caller
    their daily allowance — a same-tier follow-up search still succeeds."""
    search, _ = make_search(policy=_policy(anon=1, member=1))
    with pytest.raises(PhotoSearchRejection):
        await search(command(image=b"not-an-image"))
    result = await search(command())
    assert result.offer_id != ""


async def test_anon_quota_exhaustion_guides_toward_configuring_a_key() -> None:
    search, _ = make_search(policy=_policy(anon=1))
    await search(command())
    with pytest.raises(PhotoSearchRejection) as excinfo:
        await search(command())
    rejection = excinfo.value
    assert rejection.status_code == 429
    assert rejection.code == "photo_search_quota_exhausted"
    assert rejection.guidance == "configure_vision_key"


async def test_byok_present_but_quota_exhausted_guides_toward_switching_endpoint() -> (
    None
):
    search, _ = make_search(policy=_policy(member=0))
    with pytest.raises(PhotoSearchRejection) as excinfo:
        await search(command(user_id="user-1", user_type="human", has_byok=True))
    assert excinfo.value.guidance == "switch_vision_endpoint"


async def test_member_and_anon_quotas_are_separate_tiers() -> None:
    search, _ = make_search(policy=_policy(anon=0, member=1))
    with pytest.raises(PhotoSearchRejection):
        await search(command())
    result = await search(command(user_id="user-1", user_type="human"))
    assert result.tier == "member"


async def test_anon_id_prefix_consumes_the_anonymous_quota() -> None:
    search, _ = make_search(policy=_policy(anon=0, member=1))
    with pytest.raises(PhotoSearchRejection):
        await search(command(**_ANON))


async def test_member_identity_without_user_type_is_not_anonymized() -> None:
    search, _ = make_search(policy=_policy(anon=0, member=1))
    result = await search(command(user_id="user-1"))
    assert result.tier == "member"


async def test_result_carries_a_confirmable_offer_for_the_shown_candidates() -> None:
    clock = FixedClock()
    offers = InMemoryPhotoOfferStore(clock=clock)
    search, _ = make_search(offers=offers, clock=clock)
    result = await search(command())
    offer = offers.get(result.offer_id)
    assert offer is not None
    assert result.envelope.intent == "search_bangumi"
    assert [candidate.title for candidate in offer.candidates] == ["君の名は。"]
    assert [candidate.id for candidate in offer.candidates] == ["p1"]
    assert offer.expires_at > clock()


async def test_offer_signals_are_server_derived() -> None:
    clock = FixedClock()
    offers = InMemoryPhotoOfferStore(clock=clock)
    search, _ = make_search(offers=offers, clock=clock)
    result = await search(command())
    offer = offers.get(result.offer_id)
    assert offer is not None
    assert offer.signals == OfferSignals(
        query_type="anime_screenshot",
        gps_available=False,
        layer_hit="1",
        candidates_shown=1,
    )
    assert result.signals == offer.signals


async def test_clock_controls_the_offer_expiry() -> None:
    clock = FixedClock()
    offers = InMemoryPhotoOfferStore(clock=clock)
    search, _ = make_search(offers=offers, clock=clock)
    result = await search(command())
    clock.now = clock.now + timedelta(hours=1)
    assert offers.get(result.offer_id) is None
