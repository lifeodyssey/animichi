"""Unit tests for the photo-search phase 1 pipeline (SD-26 layers 1/2).

`run_photo_search` no longer talks to a `VisionSupply`/provider-protocol
router (#656) — it takes a `RecognizeCall`, a zero-arg async closure the
route builds from `agent.agents.photo_vision.recognize_photo`. These tests
stay focused on the pipeline's own orchestration (layer 1/2/degrade,
telemetry) and stub that closure directly with
`agent.tests.unit.photo_search_fakes.recognize_stub`/`recognize_unavailable`
— recognition's own BYOK-fallback/failure behavior is covered separately in
`test_photo_vision.py`.
"""

from __future__ import annotations

from agent.agents.photo_search import (
    GpsPoint,
    PhotoClarifyData,
    PhotoSearchData,
    run_photo_search,
)
from agent.tests.unit.photo_search_fakes import (
    NEARBY_TITLE,
    UNRESOLVABLE_TITLE,
    YOURNAME_BANGUMI_ID,
    YOURNAME_TITLE,
    AmbiguousCatalog,
    DownCatalog,
    FakeCatalog,
    recognize_stub,
    recognize_unavailable,
)

_GPS = GpsPoint(lat=35.2, lng=136.2)


async def test_layer_one_resolves_and_returns_search_envelope() -> None:
    outcome = await run_photo_search(
        recognize_stub([YOURNAME_TITLE]), FakeCatalog(), None
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
        recognize_stub([YOURNAME_TITLE]), AmbiguousCatalog(), None
    )
    assert outcome.response.intent == "clarify"
    assert isinstance(outcome.response.data, PhotoClarifyData)
    assert outcome.response.data.reason == "photo_ambiguous"
    assert len(outcome.response.data.candidates) == 2
    assert outcome.signals.candidates_shown == 2


async def test_unrecognized_photo_without_gps_degrades_to_clarify() -> None:
    outcome = await run_photo_search(recognize_stub([]), FakeCatalog(), None)
    assert outcome.response.intent == "clarify"
    assert isinstance(outcome.response.data, PhotoClarifyData)
    assert outcome.response.data.reason == "photo_unrecognized"
    assert outcome.response.data.candidates == []
    assert outcome.signals.layer_hit == "none"
    assert outcome.signals.query_type == "real_world_photo"


async def test_layer_two_merges_nearby_works_with_vision_candidates() -> None:
    catalog = FakeCatalog()
    outcome = await run_photo_search(
        recognize_stub([UNRESOLVABLE_TITLE]), catalog, _GPS
    )
    assert isinstance(outcome.response.data, PhotoClarifyData)
    titles = [candidate.title for candidate in outcome.response.data.candidates]
    assert titles == [UNRESOLVABLE_TITLE, NEARBY_TITLE]
    assert outcome.signals.layer_hit == "2"
    assert outcome.signals.gps_available is True
    assert catalog.nearby_calls == [(35.2, 136.2, 2000)]


async def test_vision_unavailable_degrades_to_clarify_instead_of_raising() -> None:
    """#502: a blown-up vision call must reach the same clarify response as a
    clean "nothing recognized" miss — never escape as an unhandled exception."""
    outcome = await run_photo_search(recognize_unavailable(), FakeCatalog(), None)
    assert outcome.response.intent == "clarify"
    assert isinstance(outcome.response.data, PhotoClarifyData)
    assert outcome.response.data.reason == "photo_unrecognized"
    assert outcome.response.data.candidates == []
    assert outcome.signals.layer_hit == "none"


async def test_vision_unavailable_uses_a_distinct_telemetry_signal() -> None:
    """#502 P1-2: a provider outage must NOT be counted the same as a clean
    "user photographed something unrecognizable" miss — that would corrupt
    the SD-22/23 success-rate signal by blaming infra failures on users."""
    outcome = await run_photo_search(recognize_unavailable(), FakeCatalog(), _GPS)
    assert outcome.signals.query_type == "vision_unavailable"
    assert outcome.signals.query_type != "real_world_photo"
    assert outcome.signals.gps_available is True


async def test_vision_unavailable_still_runs_layer_two_nearby_fallback() -> None:
    """#502 P1-2 review round 2: layer 2 (`catalog.nearby`) doesn't depend on
    vision at all (AC6) — an authenticated, located user must still see
    nearby works during a vision outage, not a blank slate. Only the
    telemetry signal changes; the degrade path itself must stay intact."""
    catalog = FakeCatalog()
    outcome = await run_photo_search(recognize_unavailable(), catalog, _GPS)
    assert isinstance(outcome.response.data, PhotoClarifyData)
    titles = [candidate.title for candidate in outcome.response.data.candidates]
    assert titles == [NEARBY_TITLE]
    assert outcome.signals.layer_hit == "2"
    assert catalog.nearby_calls == [(35.2, 136.2, 2000)]


async def test_catalog_outage_degrades_instead_of_raising() -> None:
    outcome = await run_photo_search(
        recognize_stub([YOURNAME_TITLE]), DownCatalog(), _GPS
    )
    assert outcome.response.intent == "clarify"
    assert isinstance(outcome.response.data, PhotoClarifyData)
    assert outcome.response.data.reason == "photo_unrecognized"
    assert [c.title for c in outcome.response.data.candidates] == [YOURNAME_TITLE]
    assert outcome.signals.layer_hit == "none"
