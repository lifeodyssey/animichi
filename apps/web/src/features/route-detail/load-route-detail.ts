import { notFound } from "@tanstack/react-router";
import type { Itinerary, SavedRoute } from "@animichi/contract";
import type { RouteDetail } from "./lib/data-state";

/**
 * `LoadRouteDetail` — the one owned read journey that composes the Users
 * client (the caller's saved routes) and the Catalog Point reader
 * (`planItinerary` hydrates the timed itinerary) into the route-detail view
 * model. Route selection, state projection, and coordinate order are pure and
 * unit-tested here; the query hooks wire the live clients.
 */

/** The two outbound reads LoadRouteDetail composes. */
export interface RouteDetailReadPort {
  /** The caller's owned saved routes (Users client). */
  listOwned(): Promise<{ readonly saved_routes: readonly SavedRoute[] }>;
  /** The timed itinerary over the route's points (Catalog Point reader). */
  planItinerary(pointIds: readonly string[]): Promise<Itinerary>;
}

/** Select one owned route by id; a missing id is a router 404. */
export function selectSavedRoute(routes: readonly SavedRoute[], routeId: string): SavedRoute {
  const match = routes.find((route) => route.id === routeId);
  if (!match) throw Object.assign(new Error("unknown route id"), notFound());
  return match;
}

/** The itinerary stops' coordinates in walking order (the map's pin order). */
export function routeCoordinateOrder(route: SavedRoute, itinerary: Itinerary): readonly { lat: number; lng: number }[] {
  if (route.point_ids.length === 0) return [];
  return itinerary.timed_itinerary.stops.map((stop) => ({ lat: stop.lat, lng: stop.lng }));
}

/** State projection: an owned route + its planned itinerary -> RouteDetail. */
export function projectRouteDetail(route: SavedRoute, itinerary: Itinerary): RouteDetail {
  return {
    id: route.id, title: route.title, status: route.status,
    pointCount: route.point_ids.length, scheduledDate: null,
    itinerary: itinerary.timed_itinerary, checkins: [],
  };
}

/** Load one owned route's detail through Users + Catalog Points, in order. */
export async function loadRouteDetail(port: RouteDetailReadPort, routeId: string): Promise<RouteDetail> {
  const { saved_routes } = await port.listOwned();
  const route = selectSavedRoute(saved_routes, routeId);
  const itinerary = await port.planItinerary(route.point_ids);
  return projectRouteDetail(route, itinerary);
}
