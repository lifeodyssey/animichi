import { useSuspenseQuery } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import type { SavedRoute } from "@animichi/contract";
import { users } from "../orpc";
import type { RouteDetail } from "../../lib/route-detail/data-state";

/**
 * Query options for the caller's saved routes, shared by the saved-route
 * loader (`ensureQueryData` prefetch + existence check on the server) and the
 * suspense hook (hydrated client read — no double fetch, wired by
 * `routerWithQueryClient`, and re-subscribing so retry recovers). The
 * dedicated get-by-id detail endpoint is the S2.8 integration seam; until it
 * lands the shell selects from the list the users service already exposes.
 */
export function listSavedRoutesOptions() {
  return users().listSavedRoutes.queryOptions();
}

export function useSavedRoutes() {
  return useSuspenseQuery(listSavedRoutesOptions());
}

/**
 * Map a saved route to the detail view model. `scheduledDate`/`itinerary`/
 * `checkins` are the S2.8 detail-endpoint seam (null/empty in the shell); the
 * components render skeleton slots until they arrive.
 */
export function toRouteDetail(route: SavedRoute): RouteDetail {
  const { id, title, status } = route;
  return { id, title, status, pointCount: route.point_ids.length, scheduledDate: null, itinerary: null, checkins: [] };
}

/** Select one saved route by id and map it; a missing id is a router 404. */
export function selectRouteDetail(routes: readonly SavedRoute[], routeId: string): RouteDetail {
  const match = routes.find((route) => route.id === routeId);
  if (!match) throw Object.assign(new Error("unknown route id"), notFound());
  return toRouteDetail(match);
}
