"""Unit tests for the photo-search phase 1 pipeline (SD-26 layers 1/2)."""

from __future__ import annotations

import httpx

from agent.agents.photo_search import (
    GpsPoint,
    PhotoClarifyData,
    PhotoSearchData,
    run_photo_search,
)
from agent.agents.vision_supply_router import (
    VisionCapabilityRegistry,
    VisionRecognition,
    VisionSupply,
)
from agent.tests.unit.photo_search_fakes import (
    NEARBY_TITLE,
    UNRESOLVABLE_TITLE,
    YOURNAME_BANGUMI_ID,
    YOURNAME_TITLE,
    AmbiguousCatalog,
    DownCatalog,
    FakeCatalog,
    KeyedVisionStub,
    digest,
)

_IMAGE = b"image-bytes"
_GPS = GpsPoint(lat=35.2, lng=136.2)


def _supply(titles: list[str]) -> VisionSupply:
    stub = KeyedVisionStub({digest(_IMAGE): titles})
    return VisionSupply(platform=stub, registry=VisionCapabilityRegistry())


class _DownVisionProvider:
    """#502: the platform vision call itself fails (dead key, timeout, ...)."""

    async def recognize(self, images: list[bytes], locale: str) -> VisionRecognition:
        raise httpx.ConnectError("connection refused")


async def test_layer_one_resolves_and_returns_search_envelope() -> None:
    outcome = await run_photo_search(
        _supply([YOURNAME_TITLE]), FakeCatalog(), [_IMAGE], None, "ja", False
    )
    assert outcome.response.intent == "search_bangumi"
    assert isinstance(outcome.response.data, PhotoSearchData)
    assert outcome.response.data.results.bangumi_id == YOURNAME_BANGUMI_ID
    assert outcome.response.data.results.rows[0].name == "須賀神社"
    assert outcome.signals.layer_hit == "1"
    assert outcome.signals.query_type == "anime_screenshot"
    assert outcome.signals.gps_available is False


async def test_ambiguous_resolution_becomes_clarify_with_candidates() -> None:
    outcome = await run_photo_search(
        _supply([YOURNAME_TITLE]), AmbiguousCatalog(), [_IMAGE], None, "ja", False
    )
    assert outcome.response.intent == "clarify"
    assert isinstance(outcome.response.data, PhotoClarifyData)
    assert outcome.response.data.reason == "photo_ambiguous"
    assert len(outcome.response.data.candidates) == 2
    assert outcome.signals.candidates_shown == 2


async def test_unrecognized_photo_without_gps_degrades_to_clarify() -> None:
    outcome = await run_photo_search(
        _supply([]), FakeCatalog(), [_IMAGE], None, "ja", False
    )
    assert outcome.response.intent == "clarify"
    assert isinstance(outcome.response.data, PhotoClarifyData)
    assert outcome.response.data.reason == "photo_unrecognized"
    assert outcome.response.data.candidates == []
    assert outcome.signals.layer_hit == "none"
    assert outcome.signals.query_type == "real_world_photo"


async def test_layer_two_merges_nearby_works_with_vision_candidates() -> None:
    catalog = FakeCatalog()
    outcome = await run_photo_search(
        _supply([UNRESOLVABLE_TITLE]), catalog, [_IMAGE], _GPS, "ja", False
    )
    assert isinstance(outcome.response.data, PhotoClarifyData)
    titles = [candidate.title for candidate in outcome.response.data.candidates]
    assert titles == [UNRESOLVABLE_TITLE, NEARBY_TITLE]
    assert outcome.signals.layer_hit == "2"
    assert outcome.signals.gps_available is True
    assert catalog.nearby_calls == [(35.2, 136.2, 2000)]


async def test_vision_provider_failure_degrades_to_clarify_instead_of_raising() -> None:
    """#502: a blown-up vision call must reach the same clarify response as a
    clean "nothing recognized" miss — never escape as an unhandled exception."""
    supply = VisionSupply(
        platform=_DownVisionProvider(), registry=VisionCapabilityRegistry()
    )
    outcome = await run_photo_search(supply, FakeCatalog(), [_IMAGE], None, "ja", False)
    assert outcome.response.intent == "clarify"
    assert isinstance(outcome.response.data, PhotoClarifyData)
    assert outcome.response.data.reason == "photo_unrecognized"
    assert outcome.response.data.candidates == []
    assert outcome.signals.layer_hit == "none"


async def test_catalog_outage_degrades_instead_of_raising() -> None:
    outcome = await run_photo_search(
        _supply([YOURNAME_TITLE]), DownCatalog(), [_IMAGE], _GPS, "ja", False
    )
    assert outcome.response.intent == "clarify"
    assert isinstance(outcome.response.data, PhotoClarifyData)
    assert outcome.response.data.reason == "photo_unrecognized"
    assert [c.title for c in outcome.response.data.candidates] == [YOURNAME_TITLE]
    assert outcome.signals.layer_hit == "none"
