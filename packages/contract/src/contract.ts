/**
 * The oRPC contract for the TS Catalog service's 4 read methods.
 *
 * This is the single source of truth for the request/response shapes the
 * Python Agent service (client) calls against the Catalog service (server).
 */

import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickCatalogErrors } from "./errors.js";
import { IngestResult, Origin, PilgrimagePoint, Pacing, Route } from "./models.js";

/** search(query, origin?) -> { rows, synced_at, partial? } */
export const SearchInput = z.object({
  query: z.string(),
  origin: Origin.optional(),
});
export type SearchInput = z.infer<typeof SearchInput>;

export const SearchResult = z.object({
  rows: z.array(PilgrimagePoint),
  synced_at: z.string(),
  // True when `rows` are an L1 preview (Anitabi `/lite`, first ~10 points)
  // returned immediately on an alias miss while the full ingest runs in the
  // background. Absent on a normal alias-hit (fully-published) response.
  partial: z.boolean().optional(),
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

/** ingest(bangumi_id) -> IngestResult */
export const IngestInput = z.object({
  bangumi_id: z.string(),
});
export type IngestInput = z.infer<typeof IngestInput>;

export const catalogContract = {
  search: oc
    .route({ method: "POST", path: "/catalog/search", summary: "Search pilgrimage points by anime title" })
    .input(SearchInput)
    .errors(pickCatalogErrors(["UPSTREAM_UNAVAILABLE"]))
    .output(SearchResult),
  spots: oc
    .route({ method: "POST", path: "/catalog/spots", summary: "Fetch a single pilgrimage point, optionally with distance" })
    .input(SpotsInput)
    .errors(pickCatalogErrors(["WORK_NOT_FOUND"]))
    .output(SpotsResult),
  nearby: oc
    .route({ method: "POST", path: "/catalog/nearby", summary: "Find pilgrimage points within a radius" })
    .input(NearbyInput)
    .output(NearbyResult),
  route: oc
    .route({ method: "POST", path: "/catalog/route", summary: "Plan an ordered, timed route over selected points" })
    .input(RouteInput)
    .errors(pickCatalogErrors(["ROUTE_TOO_MANY_CLUSTERS", "ROUTE_TOO_MANY_POINTS"]))
    .output(Route),
  ingest: oc
    .route({ method: "POST", path: "/catalog/ingest", summary: "Ingest a not-yet-cataloged work on demand by bangumi id" })
    .input(IngestInput)
    .output(IngestResult),
};

export type CatalogContract = typeof catalogContract;
