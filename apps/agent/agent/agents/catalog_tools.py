"""Catalog-backed implementation of the four model-callable data tools."""

from __future__ import annotations

from pydantic_ai import RunContext

from agent.agents.agent_result import (
    ProducedSearch,
    RejectedSearch,
    StepProvenance,
    StepRecord,
)
from agent.agents.catalog_adapter import build_search_state
from agent.agents.models import ToolName
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.session_state import (
    CurrentAnime,
    GeocodeStaging,
    OrderedCandidate,
    PendingClarification,
    ResultRef,
)
from agent.agents.tool_outcomes import (
    NearbyEmpty,
    NearbyMissingLocation,
    NearbyOk,
    NearbyPlaceAmbiguous,
    NearbyPlaceUnresolved,
    ResolveAmbiguous,
    ResolveNotFound,
    ResolveResolved,
    ResolveUpstreamDown,
    SearchEmpty,
    SearchOk,
)
from agent.clients.catalog_client import (
    AnimeCandidate,
    CatalogClientProtocol,
    GeocodeCandidate,
    GeocodeKind,
)
from agent.clients.catalog_client import (
    ResolveAmbiguous as CatalogResolveAmbiguous,
)
from agent.clients.catalog_client import (
    ResolveNotFound as CatalogResolveNotFound,
)
from agent.clients.catalog_client import (
    ResolveResolved as CatalogResolveResolved,
)
from agent.clients.errors import APIError

_CATALOG_ERRORS = (APIError, OSError, RuntimeError)


def _record(
    deps: RuntimeDeps,
    tool: str,
    params: dict[str, object],
    data: dict[str, object],
    *,
    success: bool = True,
    provenance: StepProvenance | None = None,
) -> None:
    deps.steps.append(
        StepRecord(
            tool=tool,
            success=success,
            params=params,
            data=data,
            provenance=provenance,
        )
    )


def _candidate(candidate: AnimeCandidate) -> OrderedCandidate:
    return OrderedCandidate(
        id=candidate.bangumi_id,
        title=candidate.title or candidate.title_cn or candidate.bangumi_id,
        cover_url=candidate.cover_url or None,
        points_count=candidate.points_count,
    )


def _place_candidate(candidate: GeocodeCandidate) -> OrderedCandidate:
    return OrderedCandidate(
        id=candidate.id,
        title=candidate.label,
        lat=candidate.lat,
        lng=candidate.lng,
        effective_radius_m=candidate.effective_radius_m,
    )


def _set_pending(
    deps: RuntimeDeps, reason: str, candidates: list[OrderedCandidate]
) -> None:
    session = deps.tool_state.session
    session.clarification_revision += 1
    session.pending_clarification = PendingClarification.model_validate(
        {
            "reason": reason,
            "candidate_ids": [candidate.id for candidate in candidates],
            "ordered_candidates": candidates,
            "revision": session.clarification_revision,
        }
    )
    session.geocode_staging = None


def _clear_pending(deps: RuntimeDeps) -> None:
    deps.tool_state.session.pending_clarification = None
    deps.tool_state.session.geocode_staging = None


async def run_resolve(
    ctx: RunContext[RuntimeDeps], catalog: CatalogClientProtocol, title: str
) -> ResolveResolved | ResolveAmbiguous | ResolveNotFound | ResolveUpstreamDown:
    """Resolve one anime and atomically stage every clarify outcome."""
    result: ResolveResolved | ResolveAmbiguous | ResolveNotFound | ResolveUpstreamDown
    try:
        resolved = await catalog.resolve(title)
    except _CATALOG_ERRORS:
        result = ResolveUpstreamDown()
    else:
        result = _adapt_resolve(ctx.deps, resolved)
    _record(
        ctx.deps, ToolName.RESOLVE_ANIME.value, {"title": title}, result.model_dump()
    )
    return result


def _adapt_resolve(
    deps: RuntimeDeps, resolved: object
) -> ResolveResolved | ResolveAmbiguous | ResolveNotFound | ResolveUpstreamDown:
    if isinstance(resolved, CatalogResolveResolved):
        _clear_pending(deps)
        match = resolved.match
        deps.tool_state.session.current_anime = CurrentAnime(
            bangumi_id=match.bangumi_id, title=match.title or match.title_cn
        )
        return ResolveResolved(
            bangumi_id=match.bangumi_id,
            anime_title=match.title or match.title_cn,
        )
    if isinstance(resolved, CatalogResolveAmbiguous):
        candidates = [_candidate(candidate) for candidate in resolved.candidates]
        _set_pending(deps, "anime_ambiguity", candidates)
        return ResolveAmbiguous(
            candidate_ids=[candidate.id for candidate in candidates]
        )
    if isinstance(resolved, CatalogResolveNotFound):
        _set_pending(deps, "anime_not_found", [])
        return ResolveNotFound()
    _clear_pending(deps)
    return ResolveUpstreamDown()


async def run_work_search(
    ctx: RunContext[RuntimeDeps], catalog: CatalogClientProtocol, bangumi_id: str
) -> SearchOk | SearchEmpty:
    """Fetch an already-resolved work without repeating free-text resolution."""
    result = await catalog.points_by_work_id(bangumi_id)
    payload = build_search_state(
        result.rows,
        kind="bangumi",
        anime_id=bangumi_id,
        partial=result.partial,
        locale=ctx.deps.locale,
    )
    ref = ResultRef(ctx.deps.ref_factory("search", payload.row_count))
    ctx.deps.tool_state.session.store_search_result(ref, payload)
    _clear_pending(ctx.deps)
    title = payload.metadata.anime_title if payload.metadata else None
    outcome: SearchOk | SearchEmpty
    if payload.row_count:
        outcome = SearchOk(
            result_ref=str(ref),
            row_count=payload.row_count,
            anime_title=title,
            partial=payload.partial,
        )
    else:
        outcome = SearchEmpty(anime_title=title)
    _record(
        ctx.deps,
        ToolName.SEARCH_BANGUMI.value,
        {"bangumi_id": bangumi_id},
        outcome.model_dump(),
        provenance=ProducedSearch(outcome=outcome.outcome, result_ref=ref),
    )
    return outcome


def _origin(deps: RuntimeDeps) -> tuple[float, float] | None:
    lat = deps.tool_state.origin_lat
    lng = deps.tool_state.origin_lng
    return (lat, lng) if lat is not None and lng is not None else None


def _place_pending(
    deps: RuntimeDeps, candidates: list[GeocodeCandidate]
) -> NearbyPlaceAmbiguous:
    ordered = [_place_candidate(candidate) for candidate in candidates]
    staging = GeocodeStaging(candidates=ordered)
    deps.tool_state.session.geocode_staging = staging
    _set_pending(deps, "place_ambiguity", staging.candidates)
    return NearbyPlaceAmbiguous(place_candidate_ids=[item.id for item in ordered])


async def _coordinates(
    deps: RuntimeDeps, catalog: CatalogClientProtocol, location: str | None
) -> (
    tuple[tuple[float, float], int]
    | NearbyPlaceAmbiguous
    | NearbyPlaceUnresolved
    | NearbyMissingLocation
):
    if location is None or not location.strip():
        origin = _origin(deps)
        if origin is not None:
            return origin, 5_000
        _set_pending(deps, "missing_location", [])
        return NearbyMissingLocation()
    candidates = await catalog.geocode(location.strip(), limit=5)
    _record(
        deps,
        ToolName.GEOCODE.value,
        {"location": location.strip()},
        {"candidate_ids": [candidate.id for candidate in candidates]},
    )
    if not candidates:
        _set_pending(deps, "unknown_place", [])
        return NearbyPlaceUnresolved(clarification_reason="unknown_place")
    if len(candidates) > 1:
        return _place_pending(deps, candidates)
    candidate = candidates[0]
    if candidate.kind == GeocodeKind.PREFECTURE:
        _set_pending(deps, "place_too_broad", [])
        return NearbyPlaceUnresolved(clarification_reason="place_too_broad")
    radius = candidate.effective_radius_m or 5_000
    return (candidate.lat, candidate.lng), radius


async def run_nearby_search(
    ctx: RunContext[RuntimeDeps],
    catalog: CatalogClientProtocol,
    location: str | None,
    radius_m: int | None,
) -> (
    NearbyOk
    | NearbyEmpty
    | NearbyPlaceAmbiguous
    | NearbyPlaceUnresolved
    | NearbyMissingLocation
):
    """Resolve a place into a typed outcome and a registry-backed geo result."""
    resolved = await _coordinates(ctx.deps, catalog, location)
    if not isinstance(resolved, tuple):
        _record(
            ctx.deps,
            ToolName.SEARCH_NEARBY.value,
            {},
            resolved.model_dump(),
            success=False,
            provenance=RejectedSearch(outcome=resolved.outcome),
        )
        return resolved
    coords, default_radius = resolved
    points = await catalog.nearby(
        coords[0], coords[1], radius_m=radius_m or default_radius
    )
    payload = build_search_state(points, kind="nearby", locale=ctx.deps.locale)
    ref = ResultRef(ctx.deps.ref_factory("search", payload.row_count))
    ctx.deps.tool_state.session.store_search_result(ref, payload)
    _clear_pending(ctx.deps)
    outcome: NearbyOk | NearbyEmpty = (
        NearbyOk(result_ref=str(ref), row_count=payload.row_count)
        if payload.row_count
        else NearbyEmpty()
    )
    params: dict[str, object] = {"location": location}
    if radius_m is not None:
        params["radius_m"] = radius_m
    _record(
        ctx.deps,
        ToolName.SEARCH_NEARBY.value,
        params,
        outcome.model_dump(),
        provenance=ProducedSearch(outcome=outcome.outcome, result_ref=ref),
    )
    return outcome
