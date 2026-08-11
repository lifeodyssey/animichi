import { useSuspenseQuery } from "@tanstack/react-query";
import type { Itinerary, SavedRoute } from "@animichi/contract";
import { catalog, users } from "../../api/orpc";
import { projectRouteDetail, selectSavedRoute } from "./load-route-detail";
import type { RouteDetail } from "./lib/data-state";

/** Query options for the caller's saved routes, shared by the route-detail
 * loader (`ensureQueryData` prefetch + existence check on the server) and the
 * suspense hook (hydrated client read — no double fetch, wired by
 * `routerWithQueryClient`). */
export function listSavedRoutesOptions() {
  return users().listSavedRoutes.queryOptions();
}

/** Query options for planning the itinerary over a route's points. */
export function planItineraryOptions(pointIds: readonly string[]) {
  return catalog().planItinerary.queryOptions({ input: { point_ids: [...pointIds] } });
}

export function useSavedRoutes() {
  return useSuspenseQuery(listSavedRoutesOptions());
}

/** Suspense hook for one route's detail: owned list -> selection -> itinerary. */
export function useRouteDetail(routeId: string): RouteDetail {
  const { data } = useSavedRoutes();
  const route = selectSavedRoute(data.saved_routes, routeId);
  const { data: itinerary } = useSuspenseQuery(planItineraryOptions(route.point_ids));
  return projectRouteDetail(route, itinerary);
}

/** Live read port bound to the Users + Catalog clients (test seams use a fake). */
export const liveRouteDetailPort = {
  listOwned: async (): Promise<{ readonly saved_routes: readonly SavedRoute[] }> => users().listSavedRoutes.call(),
  planItinerary: async (pointIds: readonly string[]): Promise<Itinerary> => catalog().planItinerary.call({ point_ids: [...pointIds] }),
};
