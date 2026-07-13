"""Catalog seam for the pilgrimage agent (hybrid architecture).

When ``RuntimeDeps.catalog`` is set, the data tools route through the Catalog
service instead of the DB Retriever / upstream APIs. These helpers call the
catalog client, shape its typed models via ``catalog_adapter``, and record/emit
the result with the same plumbing the legacy path uses (``tool_runtime``).
"""

from __future__ import annotations

from typing import NoReturn

import httpx
from pydantic_ai import ModelRetry, RunContext

from agent.agents.catalog_adapter import (
    SearchTool,
    build_resolve_payload,
    build_route_payload,
    build_search_payload,
)
from agent.agents.models import ToolName
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.tool_runtime import (
    _emit_step,
    _localize_city_names,
    _record_step,
    _summarize_for_llm,
)
from agent.clients.catalog_client import (
    CatalogClientProtocol,
    GeocodeCandidate,
    GeocodeKind,
    PilgrimagePoint,
)
from agent.clients.catalog_errors import CatalogError
from agent.clients.errors import APIError

_NO_DATA_ERROR = "No catalog data"
_TRANSIENT_ERRORS = (APIError, httpx.TransportError, httpx.TimeoutException)


def _retry_message(operation: str, exc: Exception) -> str:
    """Safe ModelRetry text for the LLM prompt (SD-19 trust boundary).

    Never embeds raw exception content or wire strings. A typed
    :class:`CatalogError` exposes a locally-built ``steering_hint()`` from
    whitelisted numeric/enum fields, so user-actionable errors can steer the
    model away from blind re-calls WITHOUT leaking a wire ``data`` string (e.g.
    ``WorkNotFoundError.bangumi_id``); everything else gets the static phrase.
    """
    if isinstance(exc, CatalogError) and exc.category == "user_actionable":
        return (
            f"Catalog {operation} rejected: {exc.steering_hint()}. Do not retry "
            "with the same parameters; explain the limit to the user."
        )
    return f"Catalog {operation} unavailable, please retry."


async def _store_catalog_result(
    deps: RuntimeDeps,
    *,
    tool: ToolName,
    params: dict[str, object],
    payload: dict[str, object],
    success: bool,
) -> dict[str, object]:
    """Record + emit a catalog-sourced tool result, mirroring _run_handler."""
    _record_step(
        deps,
        tool=tool.value,
        success=success,
        params=params,
        data=payload or None,
        error=None if success else _NO_DATA_ERROR,
    )
    if success:
        _localize_city_names(payload, deps.locale)
        deps.tool_state[tool.value] = payload
        await _emit_step(deps, tool.value, "done", payload)
        return _summarize_for_llm(tool, payload)
    await _emit_step(deps, tool.value, "failed", {"error": _NO_DATA_ERROR})
    return {}


async def _run_catalog_search(
    ctx: RunContext[RuntimeDeps],
    catalog: CatalogClientProtocol,
    *,
    tool: ToolName,
    query: str,
    params: dict[str, object],
) -> dict[str, object]:
    """Resolve/search via catalog.search() and store the shaped payload."""
    await _emit_step(ctx.deps, tool.value, "running", {})
    try:
        points = await catalog.search(query)
    except _TRANSIENT_ERRORS as exc:
        raise ModelRetry(_retry_message("search", exc)) from exc
    payload = _shape_search_or_resolve(tool, points)
    return await _store_catalog_result(
        ctx.deps, tool=tool, params=params, payload=payload, success=bool(payload)
    )


def _bangumi_search_query(state: dict[str, object], bangumi_id: str) -> str:
    """Pick the catalog query for search_bangumi: resolved title, else id.

    The catalog search path is title/query based, so prefer the title captured
    by resolve_anime; fall back to the bangumi_id when no title is known.
    """
    resolve_data = state.get("resolve_anime")
    if isinstance(resolve_data, dict):
        title = resolve_data.get("title")
        if isinstance(title, str) and title:
            return title
    return bangumi_id


def _shape_search_or_resolve(
    tool: ToolName, points: list[PilgrimagePoint]
) -> dict[str, object]:
    """Pick the resolve vs search payload shape for catalog points."""
    if tool == ToolName.RESOLVE_ANIME:
        return build_resolve_payload(points)
    search_tool: SearchTool = (
        "search_nearby" if tool == ToolName.SEARCH_NEARBY else "search_bangumi"
    )
    return build_search_payload(points, tool=search_tool)


def _origin_coordinates(state: dict[str, object]) -> tuple[float, float] | None:
    """Return typed session GPS coordinates when both values are present."""
    lat = state.get("origin_lat")
    lng = state.get("origin_lng")
    if isinstance(lat, int | float) and isinstance(lng, int | float):
        return float(lat), float(lng)
    return None


def _candidate_summary(candidate: GeocodeCandidate) -> dict[str, object]:
    """Build the trusted, bounded summary stored in an internal geocode step."""
    return {
        "id": candidate.id,
        "label": candidate.label[:120],
        "kind": candidate.kind.value,
    }


def _record_geocode(deps: RuntimeDeps, candidates: list[GeocodeCandidate]) -> None:
    """Record a successful lookup that still requires user clarification."""
    _record_step(
        deps,
        tool=ToolName.GEOCODE.value,
        success=True,
        params={},
        data={"candidates": [_candidate_summary(item) for item in candidates]},
        error=None,
    )


def _candidate_radius(candidate: GeocodeCandidate) -> int:
    """Return the default nearby radius for a resolved candidate kind."""
    if candidate.kind == GeocodeKind.CITY:
        return 10_000
    return 5_000


def _retry_for_candidates(
    deps: RuntimeDeps,
    location: str,
    candidates: list[GeocodeCandidate],
) -> NoReturn:
    """Record a non-failure geocode step and raise a clarification retry."""
    _record_geocode(deps, candidates)
    if not candidates:
        raise ModelRetry(
            f"No gazetteer match for {location[:120]!r}. "
            "Ask the user for a station or city name."
        )
    if candidates[0].kind == GeocodeKind.PREFECTURE:
        raise ModelRetry(
            f"{candidates[0].label[:120]} is too broad. "
            "Ask the user which city or station within it."
        )
    labels = ", ".join(item.label[:120] for item in candidates[:5])
    raise ModelRetry(f"Place name is ambiguous. Ask the user to choose: {labels}")


async def _resolve_catalog_coordinates(
    catalog: CatalogClientProtocol,
    deps: RuntimeDeps,
    location: str,
) -> tuple[tuple[float, float], int]:
    """Apply explicit-place-first geocoding and the GPS fallback table."""
    if not location.strip():
        origin = _origin_coordinates(deps.tool_state)
        if origin is None:
            raise ModelRetry(
                "Ask the user for a place name or to share their location."
            )
        return origin, 5_000
    try:
        candidates = await catalog.geocode(location.strip(), limit=5)
    except _TRANSIENT_ERRORS as exc:
        raise ModelRetry(_retry_message("geocode", exc)) from exc
    if len(candidates) != 1 or candidates[0].kind == GeocodeKind.PREFECTURE:
        _retry_for_candidates(deps, location, candidates)
    candidate = candidates[0]
    return (candidate.lat, candidate.lng), _candidate_radius(candidate)


async def _run_catalog_nearby(
    ctx: RunContext[RuntimeDeps],
    catalog: CatalogClientProtocol,
    *,
    location: str,
    radius: int,
    params: dict[str, object],
) -> dict[str, object]:
    """Geo-search via catalog.nearby() and store the shaped payload."""
    coords, default_radius = await _resolve_catalog_coordinates(
        catalog, ctx.deps, location
    )
    await _emit_step(ctx.deps, ToolName.SEARCH_NEARBY.value, "running", {})
    try:
        points = await catalog.nearby(
            coords[0], coords[1], radius_m=radius or default_radius
        )
    except _TRANSIENT_ERRORS as exc:
        raise ModelRetry(_retry_message("nearby", exc)) from exc
    payload = build_search_payload(points, tool="search_nearby")
    return await _store_catalog_result(
        ctx.deps,
        tool=ToolName.SEARCH_NEARBY,
        params=params,
        payload=payload,
        success=True,
    )


def _point_ids_from_state(state: dict[str, object]) -> list[str]:
    """Collect point ids from the most recent search results in tool_state."""
    search = state.get("search_bangumi") or state.get("search_nearby")
    rows = search.get("rows") if isinstance(search, dict) else None
    if not isinstance(rows, list):
        return []
    return [
        str(row["id"])
        for row in rows
        if isinstance(row, dict) and isinstance(row.get("id"), str)
    ]


async def _run_catalog_route(
    ctx: RunContext[RuntimeDeps],
    catalog: CatalogClientProtocol,
    *,
    params: dict[str, object],
) -> dict[str, object]:
    """Plan a route via catalog.route() over the searched point ids."""
    point_ids = _point_ids_from_state(ctx.deps.tool_state)
    if not point_ids:
        raise ModelRetry(
            "No pilgrimage points to route. Call search_bangumi or "
            "search_nearby first, then call plan_route."
        )
    await _emit_step(ctx.deps, ToolName.PLAN_ROUTE.value, "running", {})
    try:
        route = await catalog.route(point_ids)
    except _TRANSIENT_ERRORS as exc:
        raise ModelRetry(_retry_message("route", exc)) from exc
    payload = build_route_payload(route)
    return await _store_catalog_result(
        ctx.deps,
        tool=ToolName.PLAN_ROUTE,
        params=params,
        payload=payload,
        success=route.point_count > 0,
    )
