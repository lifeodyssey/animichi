import type { Itinerary } from "@animichi/contract/models";
import type { AgentHarnessTool, AgentHarnessToolInvocation } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import { Type, type Static } from "typebox";
import { readPublishedRoute } from "./published-route.ts";
import { displayPoints, readSearchResult } from "./search-result.ts";
import { authorizeInvocation, type PilgrimageToolContext } from "./tool-context.ts";

const parameters = Type.Object({ search_result_ref: Type.Optional(Type.String({ minLength: 1 })),
  itinerary_ref: Type.Optional(Type.String({ minLength: 1 })),
  stop_ids: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  pacing: Type.Optional(Type.Union([Type.Literal("chill"), Type.Literal("normal"), Type.Literal("packed")])) }, { additionalProperties: false });

type Params = Static<typeof parameters>;

/** Catalog itinerary planning reads stored points; it does not book travel or persist an itinerary externally. */
export const planRoute: AgentHarnessTool<PilgrimageToolContext, typeof parameters> = {
  name: "plan_route", label: "Plan a walking route", replay: "safe", parameters,
  description: "Plan the exact catalog result identified by search_result_ref, or re-route a subset of an earlier route by its itinerary_ref and the stop_ids that route published. Never invent a ref or point.",
  async execute(_id, params, _update, tools, invocation, context) {
    await authorizeInvocation(tools, invocation, context);
    if (params.itinerary_ref !== undefined) return subsetRoute(params.itinerary_ref, params, tools, invocation, context);
    if (params.search_result_ref === undefined || params.stop_ids !== undefined) return unavailable();
    return fullRoute(params.search_result_ref, params.pacing, tools, invocation, context);
  },
};

async function fullRoute(searchRef: string, pacing: Params["pacing"], tools: PilgrimageToolContext, invocation: AgentHarnessToolInvocation, context: Context) {
  const search = await readSearchResult(tools.session, tools.branch, searchRef, context);
  if (!search || search.partial || !search.rows.length) return unavailable(search);
  const itinerary = await tools.catalog.planItinerary({ point_ids: search.rows.map((point) => point.id), pacing, origin: tools.origin }, { signal: context.abortSignal });
  if (itinerary.ordered_points.some((point) => !search.rows.some((offered) => offered.id === point.id && offered.latitude === point.latitude && offered.longitude === point.longitude))) throw new Error("Catalog returned an unoffered route point");
  return routeResult(itinerary, searchRef, tools.locale, invocation.invocationId);
}

async function subsetRoute(ref: string, params: Params, tools: PilgrimageToolContext, invocation: AgentHarnessToolInvocation, context: Context) {
  const requested = params.stop_ids ?? [];
  const route = await readPublishedRoute(tools.session, tools.branch, ref, context);
  if (!route || params.search_result_ref !== undefined || !requested.length) return unavailable();
  if (requested.some((id) => !route.ids.includes(id))) return unavailable();
  const points = route.points.filter((point) => requested.includes(point.id));
  const itinerary = await tools.catalog.planItinerary({ point_ids: points.map((point) => point.id), pacing: params.pacing, origin: tools.origin }, { signal: context.abortSignal });
  if (itinerary.ordered_points.some((point) => !points.some((offered) => offered.id === point.id && offered.latitude === point.latitude && offered.longitude === point.longitude))) throw new Error("Catalog returned an unoffered route point");
  if (itinerary.ordered_points.length !== points.length) return unavailable();
  return routeResult(itinerary, ref, tools.locale, invocation.invocationId);
}

function routeResult(itinerary: Itinerary, sourceRef: string, locale: string, itineraryRef: string) {
  const details = { itinerary: { ...itinerary, ordered_points: displayPoints(itinerary.ordered_points, locale) }, source_ref: sourceRef };
  const text = JSON.stringify({ status: itinerary.point_count ? "ok" : "empty", itinerary_ref: itineraryRef,
    ordered_point_ids: itinerary.ordered_points.map((point) => point.id), point_count: itinerary.point_count,
    total_minutes: itinerary.timed_itinerary.total_minutes });
  return { content: [{ type: "text" as const, text }], details };
}

function unavailable(search?: Awaited<ReturnType<typeof readSearchResult>>) {
  const details = { status: !search ? "stale_ref" : search.partial ? "pending_sync" : "empty" };
  return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
}
