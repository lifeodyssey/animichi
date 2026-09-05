/**
 * `plan_route` — an ordered, timed route over one stored search result.
 *
 * Port of `animichi_tools.py::plan_route` × `catalog_route_tools.py::run_itinerary`.
 * The ref is required and has no session default on purpose: routing "the last
 * search" is how a model quietly routes the wrong one.
 */

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Itinerary, Pacing } from "@animichi/contract";
import type { CatalogClient } from "./catalog-client.ts";
import { degradingCatalogFailure } from "./catalog-failure-degradation.ts";
import type { ToolBudget } from "./catalog-timeouts.ts";
import type { CatalogToolSession, SearchResultPayload } from "./catalog-tool-session.ts";
import type { ItineraryOutcome, ToolDetails } from "./catalog-tool-outcomes.ts";
import { outcomeToolResult } from "./outcome-tool-result.ts";
import { buildItineraryPayload } from "./search-result-payload.ts";
import { planRouteParameters } from "./tool-schema-bridge.ts";

const DESCRIPTION = `Plan a walking route over the exact registry result named by search_result_ref. The ref is required and has no session default. Optional pacing is chill, normal, or packed. Do not call this for a request that only asks for a search, not a route, and never invent a search_result_ref — it must come from a search_bangumi or search_nearby outcome of THIS turn. A ref an earlier turn returned is dead: search again to get a live one.`;

/** A stored result worth routing, or the status that says why it is not. */
type Routable = { routable: SearchResultPayload } | { refused: ItineraryOutcome };

/** Whether the named payload can be routed at all, and why not when it cannot. */
function routable(payload: SearchResultPayload | undefined): Routable {
  if (!payload) return { refused: { status: "stale_ref" } };
  if (payload.partial) return { refused: { status: "pending_sync" } };
  if (payload.rows.length === 0) return { refused: { status: "empty" } };
  return { routable: payload };
}

/** Plan the stored rows, store the route, and report its own ref. */
async function planStored(
  catalog: CatalogClient,
  session: CatalogToolSession,
  payload: SearchResultPayload,
  ref: string,
  pacing: Pacing | undefined,
  signal?: AbortSignal,
): Promise<ItineraryOutcome> {
  const pointIds = payload.rows.map((row) => row.id).filter(Boolean);
  const itinerary = await catalog.planItinerary(pointIds, { pacing }, signal);
  // Cleared before the empty branch returns: the catalog answered, so whatever
  // choice was pending is no longer the question, however few points came back.
  session.clearPendingClarification();
  if (itinerary.point_count < 1) return { status: "empty" };
  return routed(session.storeItinerary(buildItineraryPayload(itinerary, ref, session.locale)), itinerary);
}

/** The stored route, as the model reads it: a ref and two numbers. */
function routed(itineraryRef: string, itinerary: Itinerary): ItineraryOutcome {
  return {
    status: "ok",
    itinerary_ref: itineraryRef,
    point_count: itinerary.point_count,
    total_minutes: itinerary.timed_itinerary.total_minutes,
  };
}

/** The degraded status, and the pending choice it drops on the way down. */
function routeUpstreamDown(session: CatalogToolSession): ItineraryOutcome {
  session.clearPendingClarification();
  return { status: "upstream_unavailable" };
}

/** Refuse or route the stored result the model named — never a different one. */
function routeStoredResult(
  catalog: CatalogClient,
  session: CatalogToolSession,
  params: { search_result_ref: string; pacing?: Pacing },
  budget: ToolBudget,
  signal?: AbortSignal,
): Promise<AgentToolResult<ItineraryOutcome>> {
  const ref = params.search_result_ref;
  const decided = routable(session.searchResult(ref));
  if ("refused" in decided) return Promise.resolve(outcomeToolResult(decided.refused));
  return degradingCatalogFailure("plan_route", () => routeUpstreamDown(session), (deadline) =>
    planStored(catalog, session, decided.routable, ref, params.pacing, deadline), budget, signal);
}

/** Build `plan_route` over one session's catalog and state. */
export function planRouteTool(
  catalog: CatalogClient,
  session: CatalogToolSession,
  budget: ToolBudget,
): AgentTool<typeof planRouteParameters, ToolDetails<ItineraryOutcome>> {
  return {
    name: "plan_route",
    label: "Plan a walking route",
    description: DESCRIPTION,
    parameters: planRouteParameters,
    execute: (_toolCallId, params, signal) => routeStoredResult(catalog, session, params, budget, signal),
  };
}
