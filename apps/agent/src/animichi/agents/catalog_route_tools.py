"""Catalog-backed itinerary tool execution."""

from __future__ import annotations

from typing import Literal

from pydantic_ai import RunContext

from animichi.agents.agent_result import (
    ProducedItinerary,
    RejectedItinerary,
    StepProvenance,
)
from animichi.agents.catalog_adapter import build_itinerary_state
from animichi.agents.catalog_failures import CATALOG_FAILURES
from animichi.agents.catalog_tools import _clear_pending
from animichi.agents.runtime_deps import RuntimeDeps
from animichi.agents.session_state import ItineraryRef, ResultRef
from animichi.agents.tool_event_bridge import register_tool_provenance
from animichi.agents.tool_outcomes import (
    ItineraryEmpty,
    ItineraryOk,
    ItineraryPendingSync,
    ItineraryStaleRef,
    ItineraryUpstreamDown,
)
from animichi.clients.catalog_client import CatalogClientProtocol, Itinerary

Pacing = Literal["chill", "normal", "packed"]


async def run_itinerary(
    ctx: RunContext[RuntimeDeps],
    catalog: CatalogClientProtocol,
    search_result_ref: str,
    pacing: Pacing | None,
) -> (
    ItineraryOk
    | ItineraryEmpty
    | ItineraryStaleRef
    | ItineraryPendingSync
    | ItineraryUpstreamDown
):
    """Build exactly the registry payload named by the model-supplied ref."""
    ref = ResultRef(search_result_ref)
    payload = ctx.deps.tool_state.session.search_results.get(ref)
    outcome: (
        ItineraryOk
        | ItineraryEmpty
        | ItineraryStaleRef
        | ItineraryPendingSync
        | ItineraryUpstreamDown
    )
    try:
        outcome = await _itinerary_outcome(ctx, catalog, ref, payload, pacing)
    except CATALOG_FAILURES:
        _clear_pending(ctx.deps)
        outcome = ItineraryUpstreamDown()
    register_tool_provenance(ctx, _itinerary_provenance(outcome))
    return outcome


async def _itinerary_outcome(
    ctx: RunContext[RuntimeDeps],
    catalog: CatalogClientProtocol,
    ref: ResultRef,
    payload: object,
    pacing: Pacing | None,
) -> ItineraryOk | ItineraryEmpty | ItineraryStaleRef | ItineraryPendingSync:
    from animichi.agents.session_state import SearchPayloadState

    if not isinstance(payload, SearchPayloadState):
        return ItineraryStaleRef()
    if payload.partial:
        return ItineraryPendingSync()
    if not payload.rows:
        return ItineraryEmpty()
    itinerary = await catalog.plan_itinerary(
        [point.id for point in payload.rows if point.id], pacing=pacing
    )
    if itinerary.point_count < 1:
        return ItineraryEmpty()
    return _store_itinerary(ctx, itinerary, ref)


def _store_itinerary(
    ctx: RunContext[RuntimeDeps], itinerary: Itinerary, ref: ResultRef
) -> ItineraryOk:
    itinerary_ref = ItineraryRef(ctx.deps.ref_factory("route", itinerary.point_count))
    state = build_itinerary_state(itinerary, ref, locale=ctx.deps.locale)
    ctx.deps.tool_state.session.store_itinerary(itinerary_ref, state)
    _clear_pending(ctx.deps)
    minutes = state.timed_itinerary.total_minutes if state.timed_itinerary else 0
    return ItineraryOk(
        itinerary_ref=str(itinerary_ref),
        point_count=itinerary.point_count,
        total_minutes=minutes,
    )


def _itinerary_provenance(
    outcome: ItineraryOk
    | ItineraryEmpty
    | ItineraryStaleRef
    | ItineraryPendingSync
    | ItineraryUpstreamDown,
) -> StepProvenance:
    if isinstance(outcome, ItineraryOk):
        return ProducedItinerary(
            status="ok", itinerary_ref=ItineraryRef(outcome.itinerary_ref)
        )
    return RejectedItinerary(status=outcome.status)
