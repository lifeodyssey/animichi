"""Catalog-backed tools for the pilgrimage agent."""

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
    PilgrimagePoint,
)
from agent.clients.catalog_errors import CatalogError
from agent.clients.errors import APIError
from agent.clients.geocode import GeocodeCandidate, GeocodeKind

_NO_DATA_ERROR = "No catalog data"
_TRANSIENT_ERRORS = (APIError, httpx.TransportError, httpx.TimeoutException)
_INVISIBLE_RETRY_CHARACTERS = frozenset("\x7f\u200b\u200c\u200d\u2060\ufeff")


def _retry_message(operation: str, exc: Exception) -> str:
    """Build retry text without exposing raw exception or wire content."""
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
    return {
        "id": candidate.id,
        "label": _sanitize_retry_text(candidate.label),
        "kind": candidate.kind.value,
    }


def _record_geocode(
    deps: RuntimeDeps,
    candidates: list[GeocodeCandidate] | None = None,
    *,
    condition: str | None = None,
) -> None:
    data: dict[str, object] = (
        {"condition": condition}
        if condition is not None
        else {"candidates": [_candidate_summary(item) for item in candidates or []]}
    )
    _record_step(
        deps,
        tool=ToolName.GEOCODE.value,
        success=True,
        params={},
        data=data,
        error=None,
    )


def _record_retry_failure(deps: RuntimeDeps, tool: ToolName, error: str) -> None:
    _record_step(
        deps, tool=tool.value, success=False, params={}, data=None, error=error
    )


def _candidate_radius(candidate: GeocodeCandidate) -> int:
    if candidate.effective_radius_m is not None:
        return candidate.effective_radius_m
    if candidate.kind == GeocodeKind.CITY:
        return 10_000
    return 5_000


def _sanitize_retry_text(value: str) -> str:
    return "".join(
        character
        for character in value
        if ord(character) >= 32 and character not in _INVISIBLE_RETRY_CHARACTERS
    )[:120]


def _retry_for_candidates(
    deps: RuntimeDeps,
    location: str,
    candidates: list[GeocodeCandidate],
) -> NoReturn:
    """Record a non-failure geocode step and raise a clarification retry."""
    _record_geocode(deps, candidates)
    if not candidates:
        safe_location = _sanitize_retry_text(location)
        raise ModelRetry(
            f"No gazetteer match for {safe_location!r}. Call clarify and ask "
            "the user for a station or city name."
        )
    if len(candidates) > 1:
        labels = ", ".join(_sanitize_retry_text(item.label) for item in candidates[:5])
        raise ModelRetry(
            f"Place name is ambiguous. Call clarify and ask the user to choose: {labels}"
        )
    if candidates[0].kind == GeocodeKind.PREFECTURE:
        raise ModelRetry(
            f"{_sanitize_retry_text(candidates[0].label)} is too broad. "
            "Call clarify and ask the user which city or station within it."
        )
    raise AssertionError("one non-prefecture candidate does not require clarification")


async def _resolve_catalog_coordinates(
    catalog: CatalogClientProtocol,
    deps: RuntimeDeps,
    location: str,
) -> tuple[tuple[float, float], int]:
    """Apply explicit-place-first geocoding and the GPS fallback table."""
    if not location.strip():
        origin = _origin_coordinates(deps.tool_state)
        if origin is None:
            _record_geocode(deps, condition="missing_location_and_no_gps")
            raise ModelRetry(
                "Ask the user for a place name or to share their location."
            )
        return origin, 5_000
    try:
        candidates = await catalog.geocode(location.strip(), limit=5)
    except _TRANSIENT_ERRORS as exc:
        message = _retry_message("geocode", exc)
        _record_retry_failure(deps, ToolName.GEOCODE, message)
        raise ModelRetry(message) from exc
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
        message = _retry_message("nearby", exc)
        _record_retry_failure(ctx.deps, ToolName.SEARCH_NEARBY, message)
        raise ModelRetry(message) from exc
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
