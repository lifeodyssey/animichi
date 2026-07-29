"""Photo-search phase 1 (SD-26): standalone vision recognition → resolve path.

Layer 1 rides the model's own world knowledge (no extra call); layer 2 reuses
the ``search_nearby`` coarse geo pass (``ST_DWithin`` in the catalog Worker)
when the user has shared location; layer 3 (catalog-wide vector search) is
deferred (DD-11). No new agent tool is created — recognition output is a
series-level candidate-title list handed to the existing catalog resolve
(DB-first → API fallback), and the resulting envelope reuses the chat
contract shapes so rendering shares the text-search path.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel

from agent.agents.catalog_failures import CATALOG_FAILURES
from agent.agents.vision_supply_router import VisionSupply
from agent.clients.catalog_client import (
    AnimeCandidate,
    CatalogClientProtocol,
    PilgrimagePoint,
    ResolveAmbiguous,
    ResolveResolved,
)
from agent.infrastructure.observability.photo_search import (
    LayerHit,
    PhotoSearchSignals,
    QueryType,
)

NEARBY_COARSE_RADIUS_M = 2_000
ClarifyReason = Literal["photo_unrecognized", "photo_ambiguous"]


@dataclass(frozen=True)
class GpsPoint:
    lat: float
    lng: float


class PhotoPoint(BaseModel):
    """Mirrors the contract ``StreamPoint`` keys the strict web schema allows."""

    id: str
    name: str
    bangumi_id: str
    episode: int
    screenshot_url: str
    latitude: float
    longitude: float
    title: str
    city: str | None = None


class PhotoResults(BaseModel):
    kind: Literal["bangumi"] = "bangumi"
    bangumi_id: str
    title: str
    row_count: int
    rows: list[PhotoPoint]


class PhotoSearchData(BaseModel):
    results: PhotoResults


class PhotoCandidate(BaseModel):
    """Mirrors the contract ``ClarificationCandidate`` (strict on the web side)."""

    id: str
    title: str
    bangumi_id: str | None = None
    points_count: int | None = None


class PhotoClarifyData(BaseModel):
    reason: ClarifyReason
    candidates: list[PhotoCandidate]


class PhotoSearchResponse(BaseModel):
    """A ``ChatResponseDataPart``-shaped envelope: photo results render through
    the same registry cards as text search."""

    success: Literal[True] = True
    status: Literal["ok"] = "ok"
    intent: Literal["search_bangumi", "clarify"]
    data: PhotoSearchData | PhotoClarifyData


@dataclass(frozen=True)
class PhotoSearchOutcome:
    response: PhotoSearchResponse
    signals: PhotoSearchSignals


def _point(row: PilgrimagePoint) -> PhotoPoint:
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


def _search_response(
    match: AnimeCandidate, rows: list[PilgrimagePoint]
) -> PhotoSearchResponse:
    results = PhotoResults(
        bangumi_id=match.bangumi_id,
        title=match.title or match.title_cn,
        row_count=len(rows),
        rows=[_point(row) for row in rows],
    )
    return PhotoSearchResponse(
        intent="search_bangumi", data=PhotoSearchData(results=results)
    )


def _clarify(
    reason: ClarifyReason, candidates: list[PhotoCandidate]
) -> PhotoSearchResponse:
    return PhotoSearchResponse(
        intent="clarify",
        data=PhotoClarifyData(reason=reason, candidates=candidates),
    )


def _work_candidate(candidate: AnimeCandidate) -> PhotoCandidate:
    return PhotoCandidate(
        id=candidate.bangumi_id,
        title=candidate.title or candidate.title_cn,
        bangumi_id=candidate.bangumi_id,
        points_count=candidate.points_count,
    )


def merge_candidates(
    vision_titles: list[str], works: list[PhotoCandidate]
) -> list[PhotoCandidate]:
    """AC6: nearby-derived works join the vision candidates, never replace them."""
    merged = [PhotoCandidate(id=title, title=title) for title in vision_titles]
    seen = {candidate.title for candidate in merged}
    merged.extend(work for work in works if work.title not in seen)
    return merged


def _nearby_works(points: list[PilgrimagePoint]) -> list[PhotoCandidate]:
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
    query_type: QueryType, gps: GpsPoint | None, layer_hit: LayerHit, shown: int
) -> PhotoSearchSignals:
    return PhotoSearchSignals(
        query_type=query_type,
        gps_available=gps is not None,
        layer_hit=layer_hit,
        candidates_shown=shown,
        user_confirmed=False,
    )


async def _layer_one(
    catalog: CatalogClientProtocol, titles: list[str], gps: GpsPoint | None
) -> PhotoSearchOutcome | None:
    """Series-aware handoff of the recognised titles to the resolve path."""
    try:
        resolved = await catalog.resolve(titles[0])
    except CATALOG_FAILURES:
        return None
    if isinstance(resolved, ResolveResolved):
        return await _resolved_outcome(catalog, resolved, gps)
    if isinstance(resolved, ResolveAmbiguous):
        candidates = [_work_candidate(item) for item in resolved.candidates]
        response = _clarify("photo_ambiguous", candidates)
        signals = _signals("anime_screenshot", gps, "1", len(candidates))
        return PhotoSearchOutcome(response, signals)
    return None


async def _resolved_outcome(
    catalog: CatalogClientProtocol, resolved: ResolveResolved, gps: GpsPoint | None
) -> PhotoSearchOutcome:
    rows = (await catalog.points_by_work_id(resolved.match.bangumi_id)).rows
    response = _search_response(resolved.match, rows)
    return PhotoSearchOutcome(
        response, _signals("anime_screenshot", gps, "1", len(rows))
    )


async def _layer_two(
    catalog: CatalogClientProtocol, gps: GpsPoint
) -> list[PhotoCandidate]:
    """Coarse GPS pass reusing the existing nearby retrieval (``ST_DWithin``)."""
    try:
        points = await catalog.nearby(gps.lat, gps.lng, radius_m=NEARBY_COARSE_RADIUS_M)
    except CATALOG_FAILURES:
        return []
    return _nearby_works(points)


async def _degrade(
    catalog: CatalogClientProtocol, titles: list[str], gps: GpsPoint | None
) -> PhotoSearchOutcome:
    """C2 degradation: the clarify branch, with the location signal kept (AC6)."""
    works = await _layer_two(catalog, gps) if gps is not None else []
    candidates = merge_candidates(titles, works)
    layer: LayerHit = "2" if works else "none"
    query: QueryType = "anime_screenshot" if titles else "real_world_photo"
    response = _clarify("photo_unrecognized", candidates)
    return PhotoSearchOutcome(response, _signals(query, gps, layer, len(candidates)))


async def run_photo_search(
    supply: VisionSupply,
    catalog: CatalogClientProtocol,
    images: list[bytes],
    gps: GpsPoint | None,
    locale: str,
    authenticated: bool,
) -> PhotoSearchOutcome:
    """Upload → vision (layer 1) → resolve; misses degrade via layers 2/none."""
    call = await supply.recognize(images, locale, authenticated)
    titles = call.recognition.candidate_titles
    if titles:
        outcome = await _layer_one(catalog, titles, gps)
        if outcome is not None:
            return outcome
    return await _degrade(catalog, titles, gps)
