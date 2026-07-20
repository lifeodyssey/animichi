"""Adapt typed Catalog models into the agent's named tool-result models.

The data tools call the Catalog service and receive typed
``PilgrimagePoint`` / ``Route`` models. This module re-shapes those into the
named ``ResolveAnimeResult`` / ``SearchToolResult`` / ``RouteToolResult``
models the tools return (``tool_runtime`` serializes them to dicts at the
tool_state/response boundary, so response_builder.py keeps working unchanged).

No DB, no upstream Anitabi/Bangumi clients are imported here — only deterministic
shaping helpers (``_build_nearby_groups`` / ``rewrite_image_urls``) shared with
the live ``plan_selected`` handler.
"""

from __future__ import annotations

from typing import Literal

from agent.agents.handlers._helpers import _build_nearby_groups, rewrite_image_urls
from agent.agents.runtime_models import (
    NearbyGroupModel,
    PilgrimagePointModel,
    ResultsMetadataModel,
    ResultsSummaryModel,
)
from agent.agents.tool_results import (
    ResolveAnimeResult,
    ResolveCandidate,
    RouteSummary,
    RouteToolResult,
    SearchToolResult,
)
from agent.clients.catalog_client import PilgrimagePoint, Route

SearchTool = Literal["search_bangumi", "search_nearby"]


def _point_to_row(point: PilgrimagePoint) -> dict[str, object]:
    """Serialize a typed point to the flat row dict the frontend contract uses."""
    return point.model_dump(mode="json")


def _rows_from_points(points: list[PilgrimagePoint]) -> list[dict[str, object]]:
    """Serialize points to proxy-rewritten row dicts (shared search/route shape)."""
    return rewrite_image_urls([_point_to_row(p) for p in points])


def _typed_rows(points: list[PilgrimagePoint]) -> list[PilgrimagePointModel]:
    """Serialize + proxy-rewrite points, validated back into typed rows."""
    return [
        PilgrimagePointModel.model_validate(row) for row in _rows_from_points(points)
    ]


def _search_metadata(points: list[PilgrimagePoint]) -> ResultsMetadataModel:
    """Derive anime title/cover metadata from the first point, if any."""
    if not points:
        return ResultsMetadataModel()
    head = points[0]
    return ResultsMetadataModel(
        anime_title=head.title,
        anime_title_cn=head.title_cn,
        cover_url=head.cover_url,
        data_origin="catalog",
        source="catalog",
    )


def build_search_payload(
    points: list[PilgrimagePoint], *, tool: SearchTool
) -> SearchToolResult:
    """Shape catalog points into the search/nearby tool result."""
    rows = _typed_rows(points)
    empty = not rows
    nearby_groups = [
        NearbyGroupModel.model_validate(g)
        for g in _build_nearby_groups(_rows_from_points(points))
    ]
    return SearchToolResult(
        rows=rows,
        items=rows,
        row_count=len(rows),
        strategy="geo" if tool == "search_nearby" else "bangumi",
        metadata=_search_metadata(points),
        nearby_groups=nearby_groups,
        status="empty" if empty else "ok",
        empty=empty,
        summary=ResultsSummaryModel(count=len(rows), source="catalog", cache="miss"),
    )


def _candidate(point: PilgrimagePoint) -> ResolveCandidate:
    """Build a resolve/clarify candidate from a catalog point."""
    return ResolveCandidate(
        title=point.title or point.title_cn,
        bangumi_id=point.bangumi_id,
        cover_url=point.cover_url,
        city="",
        points_count=0,
    )


def _unique_works(points: list[PilgrimagePoint]) -> list[PilgrimagePoint]:
    """Return the first point per distinct bangumi_id, preserving order."""
    seen: set[str] = set()
    works: list[PilgrimagePoint] = []
    for point in points:
        if point.bangumi_id and point.bangumi_id not in seen:
            seen.add(point.bangumi_id)
            works.append(point)
    return works


def build_resolve_payload(points: list[PilgrimagePoint]) -> ResolveAnimeResult:
    """Shape catalog points into the resolve_anime result.

    Single work -> resolved (bangumi_id, title, candidates); multiple distinct
    works -> ambiguous=True + candidates; no points -> empty candidates
    (signals failure to the caller via ``bool(result.candidates)``).
    """
    works = _unique_works(points)
    if not works:
        return ResolveAnimeResult()
    candidates = [_candidate(w) for w in works]
    if len(works) == 1:
        head = works[0]
        return ResolveAnimeResult(
            bangumi_id=head.bangumi_id,
            title=head.title or head.title_cn,
            candidates=candidates,
        )
    return ResolveAnimeResult(ambiguous=True, candidates=candidates)


def build_route_payload(route: Route) -> RouteToolResult:
    """Shape a catalog Route into the plan_route result."""
    ordered = _typed_rows(route.ordered_points)
    itinerary = route.timed_itinerary
    return RouteToolResult(
        ordered_points=ordered,
        timed_itinerary=itinerary,
        point_count=route.point_count,
        cover_url=route.cover_url,
        status="ok",
        summary=RouteSummary(
            point_count=route.point_count,
            total_minutes=itinerary.total_minutes,
            total_distance_m=itinerary.total_distance_m,
            clusters=itinerary.spot_count,
            with_coordinates=len(ordered),
            without_coordinates=0,
        ),
    )
