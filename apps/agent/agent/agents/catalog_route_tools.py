"""Catalog-backed route tool execution."""

from __future__ import annotations

from typing import Literal

from pydantic_ai import RunContext

from agent.agents.agent_result import ProducedRoute, RejectedRoute, StepProvenance
from agent.agents.catalog_adapter import build_route_state
from agent.agents.catalog_tools import _clear_pending, _record
from agent.agents.models import ToolName
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.session_state import ResultRef, RouteRef
from agent.agents.tool_outcomes import RouteEmpty, RouteOk, RouteStaleRef
from agent.clients.catalog_client import CatalogClientProtocol, Route

Pacing = Literal["chill", "normal", "packed"]


async def run_route(
    ctx: RunContext[RuntimeDeps],
    catalog: CatalogClientProtocol,
    search_result_ref: str,
    pacing: Pacing | None,
) -> RouteOk | RouteEmpty | RouteStaleRef:
    """Route exactly the registry payload named by the model-supplied ref."""
    ref = ResultRef(search_result_ref)
    payload = ctx.deps.tool_state.session.search_results.get(ref)
    outcome = await _route_outcome(ctx, catalog, ref, payload, pacing)
    _record_route(ctx.deps, search_result_ref, pacing, outcome)
    return outcome


def _record_route(
    deps: RuntimeDeps,
    search_result_ref: str,
    pacing: Pacing | None,
    outcome: RouteOk | RouteEmpty | RouteStaleRef,
) -> None:
    params: dict[str, object] = {"search_result_ref": search_result_ref}
    if pacing is not None:
        params["pacing"] = pacing
    _record(
        deps,
        ToolName.PLAN_ROUTE.value,
        params,
        outcome.model_dump(),
        success=isinstance(outcome, RouteOk),
        provenance=_route_provenance(outcome),
    )


async def _route_outcome(
    ctx: RunContext[RuntimeDeps],
    catalog: CatalogClientProtocol,
    ref: ResultRef,
    payload: object,
    pacing: Pacing | None,
) -> RouteOk | RouteEmpty | RouteStaleRef:
    from agent.agents.session_state import SearchPayloadState

    if not isinstance(payload, SearchPayloadState):
        return RouteStaleRef()
    if not payload.rows:
        return RouteEmpty()
    route = await catalog.route(
        [point.id for point in payload.rows if point.id], pacing=pacing
    )
    if route.point_count < 1:
        return RouteEmpty()
    return _store_route(ctx, route, ref)


def _store_route(ctx: RunContext[RuntimeDeps], route: Route, ref: ResultRef) -> RouteOk:
    route_ref = RouteRef(ctx.deps.ref_factory("route", route.point_count))
    state = build_route_state(route, ref, locale=ctx.deps.locale)
    ctx.deps.tool_state.session.store_route(route_ref, state)
    _clear_pending(ctx.deps)
    minutes = state.timed_itinerary.total_minutes if state.timed_itinerary else 0
    return RouteOk(
        route_ref=str(route_ref),
        point_count=route.point_count,
        total_minutes=minutes,
    )


def _route_provenance(
    outcome: RouteOk | RouteEmpty | RouteStaleRef,
) -> StepProvenance:
    if isinstance(outcome, RouteOk):
        return ProducedRoute(status="ok", route_ref=RouteRef(outcome.route_ref))
    return RejectedRoute(status=outcome.status)
