/**
 * The oRPC contract for the TS Catalog service's 4 read methods.
 *
 * This is the single source of truth for the request/response shapes the
 * Python Agent service (client) calls against the Catalog service (server).
 */

import { oc } from "@orpc/contract";
import { z } from "zod";
import { Origin, PilgrimagePoint, Pacing, Route } from "./models.js";

/** search(query, origin?) -> { rows, synced_at } */
export const SearchInput = z.object({
  query: z.string(),
  origin: Origin.optional(),
});
export type SearchInput = z.infer<typeof SearchInput>;

export const SearchResult = z.object({
  rows: z.array(PilgrimagePoint),
  synced_at: z.string(),
});
export type SearchResult = z.infer<typeof SearchResult>;

/** spots(bangumi_id, origin?) -> { point, distance_m? } */
export const SpotsInput = z.object({
  bangumi_id: z.string(),
  origin: Origin.optional(),
});
export type SpotsInput = z.infer<typeof SpotsInput>;

export const SpotsResult = z.object({
  point: PilgrimagePoint,
  distance_m: z.number().optional(),
});
export type SpotsResult = z.infer<typeof SpotsResult>;

/** nearby(lat, lng, radius_m) -> { rows } */
export const NearbyInput = z.object({
  lat: z.number(),
  lng: z.number(),
  radius_m: z.number(),
});
export type NearbyInput = z.infer<typeof NearbyInput>;

export const NearbyResult = z.object({
  rows: z.array(PilgrimagePoint),
});
export type NearbyResult = z.infer<typeof NearbyResult>;

/** route(point_ids, origin?, pacing?) -> Route */
export const RouteInput = z.object({
  point_ids: z.array(z.string()),
  origin: Origin.optional(),
  pacing: Pacing.optional(),
});
export type RouteInput = z.infer<typeof RouteInput>;

export const catalogContract = {
  search: oc
    .route({ method: "POST", path: "/catalog/search", summary: "Search pilgrimage points by anime title" })
    .input(SearchInput)
    .output(SearchResult),
  spots: oc
    .route({ method: "POST", path: "/catalog/spots", summary: "Fetch a single pilgrimage point, optionally with distance" })
    .input(SpotsInput)
    .output(SpotsResult),
  nearby: oc
    .route({ method: "POST", path: "/catalog/nearby", summary: "Find pilgrimage points within a radius" })
    .input(NearbyInput)
    .output(NearbyResult),
  route: oc
    .route({ method: "POST", path: "/catalog/route", summary: "Plan an ordered, timed route over selected points" })
    .input(RouteInput)
    .output(Route),
};

export type CatalogContract = typeof catalogContract;
