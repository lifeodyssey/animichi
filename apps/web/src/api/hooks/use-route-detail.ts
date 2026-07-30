import { useSuspenseQuery } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import type { UserRoute } from "@animichi/contract";
import { users } from "../orpc";
import type { RouteDetail } from "../../lib/route-detail/dataState";

/**
 * Query options for the caller's saved routes, shared by the route loader
 * (`ensureQueryData` prefetch + existence check on the server) and the suspense
 * hook (hydrated client read — no double fetch, wired by `routerWithQueryClient`,
 * and re-subscribing so retry recovers). The dedicated get-by-id detail endpoint
 * is the S2.8 integration seam; until it lands the shell selects from the list
 * the users service already exposes.
 */
export function listRoutesOptions() {
  return users().listRoutes.queryOptions();
}

export function useSavedRoutes() {
  return useSuspenseQuery(listRoutesOptions());
}

/**
 * Map a saved route to the detail view model. `scheduledDate`/`itinerary`/
 * `checkins` are the S2.8 detail-endpoint seam (null/empty in the shell); the
 * components render skeleton slots until they arrive.
 */
export function toRouteDetail(route: UserRoute): RouteDetail {
  const { id, title, status } = route;
  return { id, title, status, pointCount: route.point_ids.length, scheduledDate: null, itinerary: null, checkins: [] };
}

/** Select one route by id and map it; a missing id is a router 404. */
export function selectRouteDetail(routes: readonly UserRoute[], routeId: string): RouteDetail {
  const match = routes.find((route) => route.id === routeId);
  if (!match) throw Object.assign(new Error("unknown route id"), notFound());
  return toRouteDetail(match);
}
