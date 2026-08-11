"""Photo-search recognition pipeline (SD-26) — the vision + Catalog adapter.

Layer 1 rides the model's own world knowledge (no extra call); layer 2 reuses
the ``search_nearby`` coarse geo pass (``ST_DWithin`` in the catalog Worker)
when the user has shared location; layer 3 (catalog-wide vector search) is
deferred (DD-11). Recognition output is a series-level candidate-title list
handed to the existing catalog resolve (DB-first → API fallback).

This module implements the application's :class:`PhotoSearchPipeline` port
(``application.search_photo``): it consumes the neutral
:class:`RecognizePhoto` call and :class:`GpsPoint`, and returns the neutral
:class:`PipelineOutcome`. No PydanticAI type appears at this seam — the wire
envelope is mapped to the generated boundary models by the route.
"""

from __future__ import annotations

from dataclasses import replace

from animichi.agents.catalog_failures import CATALOG_FAILURES
from animichi.agents.photo_vision import VisionRecognitionFailed
from animichi.application.catalog_read_gateway import CatalogReadGateway
from animichi.application.photo_offers import (
    OfferLayerHit,
    OfferQueryType,
    OfferSignals,
)
from animichi.application.photo_search_envelope import (
    ClarifyReason,
    PhotoCandidate,
    PhotoPoint,
    PhotoResults,
    PhotoSearchData,
    PhotoSearchEnvelope,
    PipelineOutcome,
)
from animichi.application.search_photo import (
    GpsPoint,
    RecognizePhoto,
)
from animichi.clients.catalog_client import (
    AnimeCandidate,
    Point,
    ResolveAmbiguous,
    ResolveResolved,
)

NEARBY_COARSE_RADIUS_M = 2_000


def _point(row: Point) -> PhotoPoint:
    return PhotoPoint(
        id=row.id,
        name=row.name,
        bangumi_id=row.bangumi_id,
        episode=row.episode,
        screenshot_url=row.screenshot_url,
        latitude=row.latitude,
        longitude=row.longitude,
        title=row.title,
        city=row.city,
    )


def _search_envelope(match: AnimeCandidate, rows: list[Point]) -> PhotoSearchEnvelope:
    results = PhotoResults(
        bangumi_id=match.bangumi_id,
        title=match.title or match.title_cn,
        row_count=len(rows),
        rows=tuple(_point(row) for row in rows),
    )
    return PhotoSearchEnvelope(
        intent="search_bangumi", data=PhotoSearchData(results=results)
    )


def _clarify(
    reason: ClarifyReason, candidates: list[PhotoCandidate]
) -> PhotoSearchEnvelope:
    return PhotoSearchEnvelope(
        intent="clarify",
        data=PhotoSearchData(reason=reason, candidates=tuple(candidates)),
    )


def _work_candidate(candidate: AnimeCandidate) -> PhotoCandidate:
    return PhotoCandidate(
        id=candidate.bangumi_id,
        title=candidate.title or candidate.title_cn,
        bangumi_id=candidate.bangumi_id,
    )


def merge_candidates(
    vision_titles: list[str], works: list[PhotoCandidate]
) -> list[PhotoCandidate]:
    """AC6: nearby-derived works join the vision candidates, never replace them."""
    merged = [PhotoCandidate(id=title, title=title) for title in vision_titles]
    seen = {candidate.title for candidate in merged}
    merged.extend(work for work in works if work.title not in seen)
    return merged


def _nearby_works(points: list[Point]) -> list[PhotoCandidate]:
    works: dict[str, PhotoCandidate] = {}
    for point in points:
        if point.bangumi_id and point.bangumi_id not in works:
            works[point.bangumi_id] = PhotoCandidate(
                id=point.bangumi_id,
                title=point.title or point.name,
                bangumi_id=point.bangumi_id,
            )
    return list(works.values())


def _signals(
    query_type: OfferQueryType,
    gps: GpsPoint | None,
    layer_hit: OfferLayerHit,
    shown: int,
) -> OfferSignals:
    return OfferSignals(
        query_type=query_type,
        gps_available=gps is not None,
        layer_hit=layer_hit,
        candidates_shown=shown,
    )


async def _layer_one(
    catalog: CatalogReadGateway, titles: list[str], gps: GpsPoint | None
) -> PipelineOutcome | None:
    """Series-aware handoff of the recognised titles to the resolve path."""
    try:
        resolved = await catalog.resolve(titles[0])
    except CATALOG_FAILURES:
        return None
    if isinstance(resolved, ResolveResolved):
        return await _resolved_outcome(catalog, resolved, gps)
    if isinstance(resolved, ResolveAmbiguous):
        candidates = [_work_candidate(item) for item in resolved.candidates]
        envelope = _clarify("photo_ambiguous", candidates)
        signals = _signals("anime_screenshot", gps, "1", len(candidates))
        return PipelineOutcome(envelope, signals)
    return None


async def _resolved_outcome(
    catalog: CatalogReadGateway, resolved: ResolveResolved, gps: GpsPoint | None
) -> PipelineOutcome:
    rows = (await catalog.points_by_bangumi_id(resolved.match.bangumi_id)).rows
    envelope = _search_envelope(resolved.match, rows)
    return PipelineOutcome(envelope, _signals("anime_screenshot", gps, "1", len(rows)))


async def _layer_two(
    catalog: CatalogReadGateway, gps: GpsPoint
) -> list[PhotoCandidate]:
    """Coarse GPS pass reusing the existing nearby retrieval (``ST_DWithin``)."""
    try:
        points = await catalog.nearby(gps.lat, gps.lng, radius_m=NEARBY_COARSE_RADIUS_M)
    except CATALOG_FAILURES:
        return []
    return _nearby_works(points)


async def _degrade(
    catalog: CatalogReadGateway, titles: list[str], gps: GpsPoint | None
) -> PipelineOutcome:
    """C2 degradation: the clarify branch, with the location signal kept (AC6)."""
    works = await _layer_two(catalog, gps) if gps is not None else []
    candidates = merge_candidates(titles, works)
    layer: OfferLayerHit = "2" if works else "none"
    query: OfferQueryType = "anime_screenshot" if titles else "real_world_photo"
    envelope = _clarify("photo_unrecognized", candidates)
    return PipelineOutcome(envelope, _signals(query, gps, layer, len(candidates)))


async def _vision_unavailable_outcome(
    catalog: CatalogReadGateway, gps: GpsPoint | None
) -> PipelineOutcome:
    """A provider outage is not a genuine "nothing recognized" miss (#502
    P1-2, review round 2): counting it as ``real_world_photo`` would corrupt
    the SD-22/23 success-rate signal by attributing infra failures to what
    users photographed. Still runs the *same* C2 degrade path — including
    the layer-2 nearby fallback (AC6) — so an authenticated, located user
    sees nearby works instead of a blank slate during an outage; only the
    telemetry signal is overridden. The wire response still reuses
    ``photo_unrecognized`` (same UX as a clean miss) — a distinct
    user-facing "we're down" vs. "we don't recognize this" copy is
    deliberately deferred (follow-up #518, not a silent scope cut).
    """
    outcome = await _degrade(catalog, [], gps)
    signals = replace(outcome.signals, query_type="vision_unavailable")
    return PipelineOutcome(outcome.envelope, signals)


async def run_photo_search(
    recognize: RecognizePhoto,
    catalog: CatalogReadGateway,
    gps: GpsPoint | None,
) -> PipelineOutcome:
    """Upload → vision (layer 1) → resolve; misses degrade via layers 2/none.

    ``recognize`` is a zero-arg callable already bound to the images, locale,
    and resolved model(s) for this turn (`animichi.agents.photo_vision`) — the
    route builds it once BYOK/platform model resolution is done, keeping this
    pipeline's own logic ignorant of *how* recognition happens.

    A vision call that fails outright (BYOK and platform both exhausted)
    degrades to a clarify response like a clean miss, but keeps a distinct
    telemetry signal (``_vision_unavailable_outcome``) — never a 500.
    """
    try:
        call = await recognize()
    except VisionRecognitionFailed:
        return await _vision_unavailable_outcome(catalog, gps)
    titles = call.candidate_titles
    usage = call.usage
    provider_kind = call.provider_kind
    if titles:
        outcome = await _layer_one(catalog, titles, gps)
        if outcome is not None:
            return replace(outcome, usage=usage, provider_kind=provider_kind)
    outcome = await _degrade(catalog, titles, gps)
    return replace(outcome, usage=usage, provider_kind=provider_kind)
