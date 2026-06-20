"""Adapt typed Catalog models into the agent's tool-state payload shapes.

The data tools used to call handlers -> Retriever -> DB and receive dict payloads
shaped by ``handlers._helpers.build_query_payload`` / ``optimize_route``. In the
hybrid architecture those tools call the Catalog service and receive typed
``PilgrimagePoint`` / ``Route`` models instead. This module re-shapes those typed
models into the SAME dict payloads, so the response builder, ``_summarize_for_llm``
and the output_validator keep working unchanged.

No DB, no upstream Anitabi/Bangumi clients are imported here — only deterministic
shaping helpers shared with the legacy handlers.
"""

from __future__ import annotations

from typing import Literal

from backend.agents.handlers._helpers import _build_nearby_groups, rewrite_image_urls
from backend.clients.catalog_client import PilgrimagePoint, Route

SearchTool = Literal["search_bangumi", "search_nearby"]


def _point_to_row(point: PilgrimagePoint) -> dict[str, object]:
    """Serialize a typed point to the flat row dict the frontend contract uses."""
    return point.model_dump(mode="json")


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
    rows = rewrite_image_urls([_point_to_row(p) for p in points])
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


def _candidate(point: PilgrimagePoint) -> dict[str, object]:
    """Build a resolve/clarify candidate from a catalog point."""
    return {
        "title": point.title or point.title_cn,
        "bangumi_id": point.bangumi_id,
        "cover_url": point.cover_url,
        "city": "",
        "points_count": 0,
    }


def _unique_works(points: list[PilgrimagePoint]) -> list[PilgrimagePoint]:
    """Return the first point per distinct bangumi_id, preserving order."""
    seen: set[str] = set()
    works: list[PilgrimagePoint] = []
    for point in points:
        if point.bangumi_id and point.bangumi_id not in seen:
            seen.add(point.bangumi_id)
            works.append(point)
    return works


def build_resolve_payload(points: list[PilgrimagePoint]) -> dict[str, object]:
    """Shape catalog points into the resolve_anime tool_state payload.

    Single work -> resolved {bangumi_id, title, candidates}; multiple distinct
    works -> {ambiguous: True, candidates}; no points -> empty (signals failure).
    """
    works = _unique_works(points)
    if not works:
        return {}
    candidates = [_candidate(w) for w in works]
    if len(works) == 1:
        head = works[0]
        return {
            "bangumi_id": head.bangumi_id,
            "title": head.title or head.title_cn,
            "candidates": candidates,
        }
    return {"ambiguous": True, "candidates": candidates}


def build_route_payload(route: Route) -> dict[str, object]:
    """Shape a catalog Route into the plan_route tool_state payload."""
    ordered = rewrite_image_urls([_point_to_row(p) for p in route.ordered_points])
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
