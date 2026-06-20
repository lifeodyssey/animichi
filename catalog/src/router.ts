import { os, type } from "@orpc/server";

/**
 * Catalog oRPC router — 4 stub methods returning mock data.
 *
 * These are intentionally stubs for the scaffold + spike card. Their input
 * field names and output envelopes conform to the single source of truth in
 * packages/contract (search / spots / nearby / route). Later cards wire these
 * to the real Drizzle + PostGIS queries (validated by the spike test).
 *
 * `type<T>()` is oRPC's built-in passthrough validator — it gives us typed
 * inputs/outputs without pulling the contract's zod schemas into the spike.
 * The shapes below MUST stay in lockstep with packages/contract/src.
 */

/** A single pilgrimage point row — mirrors PilgrimagePoint in packages/contract. */
export interface PilgrimagePoint {
  id: string;
  name: string;
  bangumi_id: string;
  screenshot_url: string;
  latitude: number;
  longitude: number;
  distance_m?: number;
}

const MOCK_POINTS: PilgrimagePoint[] = [
  {
    id: "spot-1",
    name: "鷲宮神社",
    bangumi_id: "1",
    screenshot_url: "",
    latitude: 36.1019,
    longitude: 139.6586,
  },
  {
    id: "spot-2",
    name: "大洗磯前神社",
    bangumi_id: "2",
    screenshot_url: "",
    latitude: 36.3142,
    longitude: 140.5876,
  },
];

/** search(query, origin?) -> { rows, synced_at } */
const search = os
  .input(type<{ query: string; origin?: unknown }>())
  .handler(async () => {
    return { rows: MOCK_POINTS, synced_at: new Date(0).toISOString() };
  });

/** spots(bangumi_id, origin?) -> { point, distance_m? } */
const spots = os
  .input(type<{ bangumi_id: string; origin?: unknown }>())
  .handler(async ({ input }) => {
    const point =
      MOCK_POINTS.find((p) => p.bangumi_id === input.bangumi_id) ?? MOCK_POINTS[0];
    return { point };
  });

/** nearby(lat, lng, radius_m) -> { rows } */
const nearby = os
  .input(type<{ lat: number; lng: number; radius_m: number }>())
  .handler(async () => {
    return { rows: MOCK_POINTS };
  });

/** route(point_ids, origin?, pacing?) -> Route */
const route = os
  .input(type<{ point_ids: string[]; origin?: unknown; pacing?: string }>())
  .handler(async ({ input }) => {
    const ordered = MOCK_POINTS.filter((p) => input.point_ids.includes(p.id));
    return {
      ordered_points: ordered,
      point_count: ordered.length,
      timed_itinerary: {
        stops: [],
        legs: [],
        total_minutes: 0,
        total_distance_m: 0,
      },
    };
  });

export const catalogRouter = { search, spots, nearby, route };

export type CatalogRouter = typeof catalogRouter;
