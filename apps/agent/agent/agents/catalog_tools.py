"""Catalog seam for the pilgrimage agent (hybrid architecture).

When ``RuntimeDeps.catalog`` is set, the data tools route through the Catalog
service instead of the DB Retriever / upstream APIs. These helpers call the
catalog client, shape its typed models via ``catalog_adapter``, and record/emit
the result with the same plumbing the legacy path uses (``tool_runtime``).
"""

from __future__ import annotations

from typing import Literal, TypeVar, overload

import httpx
from pydantic import BaseModel
from pydantic_ai import ModelRetry, RunContext

from agent.agents.catalog_adapter import (
    SearchTool,
    build_resolve_payload,
    build_route_payload,
    build_search_payload,
)
from agent.agents.models import ToolName
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.sql_agent import KNOWN_LOCATIONS
from agent.agents.tool_results import (
    ResolveAnimeResult,
    RouteToolResult,
    SearchToolPreview,
    SearchToolResult,
)
from agent.agents.tool_runtime import (
    _emit_step,
    _localize_city_names,
    _record_step,
    _summarize_for_llm,
)
from agent.agents.tool_state import ToolState
from agent.clients.catalog_client import CatalogClientProtocol, PilgrimagePoint
from agent.clients.errors import APIError

_NO_DATA_ERROR = "No catalog data"
_TRANSIENT_ERRORS = (APIError, httpx.TransportError, httpx.TimeoutException)

T = TypeVar("T", bound=BaseModel)


async def _store_catalog_result(
    deps: RuntimeDeps,
    *,
    tool: ToolName,
    params: dict[str, object],
    payload: T,
    success: bool,
) -> T | None:
    """Record + emit a catalog-sourced tool result, mirroring _run_handler."""
    if not success:
        await _record_catalog_failure(deps, tool=tool, params=params)
        return None
    return await _record_catalog_success(
        deps, tool=tool, params=params, payload=payload
    )


async def _record_catalog_failure(
    deps: RuntimeDeps, *, tool: ToolName, params: dict[str, object]
) -> None:
    """Record + emit a "no data" step; nothing is written to tool_state."""
    _record_step(
        deps,
        tool=tool.value,
        success=False,
        params=params,
        data=None,
        error=_NO_DATA_ERROR,
    )
    await _emit_step(deps, tool.value, "failed", {"error": _NO_DATA_ERROR})
    return None


async def _record_catalog_success(
    deps: RuntimeDeps, *, tool: ToolName, params: dict[str, object], payload: T
) -> T:
    """Store the serialized payload in tool_state and emit the "done" step."""
    data = payload.model_dump(mode="json")
    _localize_city_names(data, deps.locale)
    _record_step(
        deps, tool=tool.value, success=True, params=params, data=data, error=None
    )
    deps.tool_state[tool.value] = data
    await _emit_step(deps, tool.value, "done", data)
    return payload


def _has_results(
    tool: ToolName, payload: ResolveAnimeResult | SearchToolResult
) -> bool:
    """True when the shaped payload carries usable data.

    Mirrors the legacy ``bool(dict)`` truthiness check: resolve_anime "fails"
    when it found no candidates; a shaped search payload is always truthy
    (matches the pre-existing behavior where search_bangumi never signals
    failure through this path, even with zero rows).
    """
    if isinstance(payload, ResolveAnimeResult):
        return bool(payload.candidates)
    return True


@overload
async def _run_catalog_search(
    ctx: RunContext[RuntimeDeps],
    catalog: CatalogClientProtocol,
    *,
    tool: Literal[ToolName.RESOLVE_ANIME],
    query: str,
    params: dict[str, object],
) -> ResolveAnimeResult | None: ...


@overload
async def _run_catalog_search(
    ctx: RunContext[RuntimeDeps],
    catalog: CatalogClientProtocol,
    *,
    tool: Literal[ToolName.SEARCH_BANGUMI],
    query: str,
    params: dict[str, object],
) -> SearchToolResult | SearchToolPreview | None: ...


async def _run_catalog_search(
    ctx: RunContext[RuntimeDeps],
    catalog: CatalogClientProtocol,
    *,
    tool: ToolName,
    query: str,
    params: dict[str, object],
) -> ResolveAnimeResult | SearchToolResult | SearchToolPreview | None:
    """Resolve/search via catalog.search() and store the shaped payload."""
    await _emit_step(ctx.deps, tool.value, "running", {})
    try:
        points = await catalog.search(query)
    except _TRANSIENT_ERRORS as exc:
        raise ModelRetry(f"Catalog search unavailable, please retry. ({exc})") from exc
    payload = _shape_search_or_resolve(tool, points)
    stored = await _store_catalog_result(
        ctx.deps,
        tool=tool,
        params=params,
        payload=payload,
        success=_has_results(tool, payload),
    )
    return _summarize_for_llm(tool, stored) if stored is not None else None


def _bangumi_search_query(state: ToolState, bangumi_id: str) -> str:
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
) -> ResolveAnimeResult | SearchToolResult:
    """Pick the resolve vs search payload shape for catalog points."""
    if tool == ToolName.RESOLVE_ANIME:
        return build_resolve_payload(points)
    search_tool: SearchTool = (
        "search_nearby" if tool == ToolName.SEARCH_NEARBY else "search_bangumi"
    )
    return build_search_payload(points, tool=search_tool)


def _geocode_for_catalog(location: str, state: ToolState) -> tuple[float, float] | None:
    """Resolve coords from session state, then deterministic KNOWN_LOCATIONS.

    Stays upstream-free: no LLM, no Google Geocoding. The catalog service owns
    richer geocoding; the agent only forwards coordinates it can resolve locally.
    """
    lat = state.get("origin_lat")
    lng = state.get("origin_lng")
    if isinstance(lat, int | float) and isinstance(lng, int | float):
        return float(lat), float(lng)
    return KNOWN_LOCATIONS.get(location.strip())


async def _run_catalog_nearby(
    ctx: RunContext[RuntimeDeps],
    catalog: CatalogClientProtocol,
    *,
    location: str,
    radius: int,
    params: dict[str, object],
) -> SearchToolResult | SearchToolPreview | None:
    """Geo-search via catalog.nearby() and store the shaped payload."""
    coords = _geocode_for_catalog(location, ctx.deps.tool_state)
    if coords is None:
        raise ModelRetry(
            f"Could not resolve coordinates for '{location}'. "
            "Ask the user for a more specific station or city name."
        )
    await _emit_step(ctx.deps, ToolName.SEARCH_NEARBY.value, "running", {})
    try:
        points = await catalog.nearby(coords[0], coords[1], radius_m=radius or 5000)
    except _TRANSIENT_ERRORS as exc:
        raise ModelRetry(f"Catalog nearby unavailable, please retry. ({exc})") from exc
    payload = build_search_payload(points, tool="search_nearby")
    stored = await _store_catalog_result(
        ctx.deps,
        tool=ToolName.SEARCH_NEARBY,
        params=params,
        payload=payload,
        success=bool(payload.rows),
    )
    return (
        _summarize_for_llm(ToolName.SEARCH_NEARBY, stored)
        if stored is not None
        else None
    )


def _point_ids_from_state(state: ToolState) -> list[str]:
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
) -> RouteToolResult | None:
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
        raise ModelRetry(f"Catalog route unavailable, please retry. ({exc})") from exc
    payload = build_route_payload(route)
    # No LLM-facing summarization for plan_route: _summarize_for_llm only
    # shrinks search_bangumi/search_nearby results, so the full typed result
    # is what the tool returns here too.
    return await _store_catalog_result(
        ctx.deps,
        tool=ToolName.PLAN_ROUTE,
        params=params,
        payload=payload,
        success=route.point_count > 0,
    )
