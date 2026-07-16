"""Adapt typed Catalog models into the SessionState registry and wire payloads.

No DB or upstream client is imported here; the helpers are deterministic and
the typed registry remains the sole response carrier.
"""

from __future__ import annotations

from typing import Literal

from agent.agents.geo_names import localized_city_name
from agent.agents.handlers._helpers import _build_nearby_groups, rewrite_image_urls
from agent.agents.session_state import (
    NearbyGroupState,
    PointState,
    ResultRef,
    RoutePayloadState,
    RouteSummaryState,
    SearchMetadataState,
    SearchPayloadState,
    TimedItineraryState,
)
from agent.clients.catalog_client import PilgrimagePoint, Route

SearchTool = Literal["search_bangumi", "search_nearby"]


def _point_to_row(point: PilgrimagePoint) -> dict[str, object]:
    """Serialize a typed point to the flat row dict the frontend contract uses."""
    return point.model_dump(mode="json")


def _rows_from_points(points: list[PilgrimagePoint]) -> list[dict[str, object]]:
    """Serialize points to proxy-rewritten row dicts (shared search/route shape)."""
    return rewrite_image_urls([_point_to_row(p) for p in points])


def _search_metadata(points: list[PilgrimagePoint]) -> dict[str, object]:
    """Derive anime title/cover metadata from the first point, if any."""
    if not points:
        return {}
    head = points[0]
    return {
        "anime_title": head.title,
        "anime_title_cn": head.title_cn,
        "cover_url": head.cover_url,
        "data_origin": "catalog",
        "source": "catalog",
    }


def build_search_payload(
    points: list[PilgrimagePoint], *, tool: SearchTool
) -> dict[str, object]:
    """Shape catalog points into the search/nearby tool_state payload."""
    rows = _rows_from_points(points)
    empty = not rows
    return {
        "rows": rows,
        "items": rows,
        "row_count": len(rows),
        "strategy": "geo" if tool == "search_nearby" else "bangumi",
        "metadata": _search_metadata(points),
        "nearby_groups": _build_nearby_groups(rows),
        "status": "empty" if empty else "ok",
        "empty": empty,
        "summary": {"count": len(rows), "source": "catalog", "cache": "miss"},
    }


def build_route_payload(route: Route) -> dict[str, object]:
    """Shape a catalog Route into the plan_route tool_state payload."""
    ordered = _rows_from_points(route.ordered_points)
    itinerary = route.timed_itinerary
    return {
        "ordered_points": ordered,
        "timed_itinerary": itinerary.model_dump(mode="json"),
        "point_count": route.point_count,
        "cover_url": route.cover_url,
        "status": "ok",
        "summary": {
            "point_count": route.point_count,
            "total_minutes": itinerary.total_minutes,
            "total_distance_m": itinerary.total_distance_m,
            "clusters": itinerary.spot_count,
            "with_coordinates": len(ordered),
            "without_coordinates": 0,
        },
    }


def build_search_state(
    points: list[PilgrimagePoint],
    *,
    kind: Literal["bangumi", "nearby"],
    anime_id: str | None = None,
    partial: bool = False,
    locale: str,
) -> SearchPayloadState:
    """Adapt catalog points into the sole typed response carrier."""
    tool: SearchTool = "search_nearby" if kind == "nearby" else "search_bangumi"
    localized = [_localized_point(point, locale) for point in points]
    payload = build_search_payload(localized, tool=tool)
    raw_metadata = payload.get("metadata")
    raw_groups = payload.get("nearby_groups")
    raw_rows = payload.get("rows")
    groups = raw_groups if isinstance(raw_groups, list) else []
    rows = raw_rows if isinstance(raw_rows, list) else []
    metadata = raw_metadata if isinstance(raw_metadata, dict) else None
    return SearchPayloadState(
        kind=kind,
        rows=[PointState.model_validate(row) for row in rows],
        row_count=len(points),
        metadata=SearchMetadataState.model_validate(metadata) if metadata else None,
        nearby_groups=[NearbyGroupState.model_validate(group) for group in groups],
        anime_id=anime_id,
        partial=partial,
    )


def build_route_state(
    route: Route, source_ref: ResultRef | None, *, locale: str
) -> RoutePayloadState:
    """Adapt a non-empty catalog route into the typed route registry."""
    localized = route.model_copy(
        update={
            "ordered_points": [
                _localized_point(point, locale) for point in route.ordered_points
            ]
        }
    )
    payload = build_route_payload(localized)
    summary = payload["summary"]
    itinerary = payload["timed_itinerary"]
    raw_points = payload["ordered_points"]
    points = raw_points if isinstance(raw_points, list) else []
    return RoutePayloadState(
        ordered_points=[PointState.model_validate(row) for row in points],
        timed_itinerary=TimedItineraryState.model_validate(itinerary),
        summary=RouteSummaryState.model_validate(summary),
        source_ref=source_ref,
    )


def _localized_point(point: PilgrimagePoint, locale: str) -> PilgrimagePoint:
    if point.city is None:
        return point
    return point.model_copy(update={"city": localized_city_name(point.city, locale)})
