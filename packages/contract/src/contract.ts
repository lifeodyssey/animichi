/**
 * The oRPC contract for the TS Catalog service procedures.
 *
 * This is the single source of truth for the request/response shapes the
 * Python Agent service (client) calls against the Catalog service (server).
 */

import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickCatalogErrors } from "./errors.js";
import {
  IngestResult,
  Latitude,
  Longitude,
  Origin,
  PilgrimagePoint,
  Pacing,
  ResolveOutcome,
  Route,
} from "./models.js";

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

/** resolve(query) -> deterministic anime identity outcome */
export const ResolveInput = z.object({ query: z.string() });
export type ResolveInput = z.infer<typeof ResolveInput>;

/** pointsByWorkId(work_id) -> the existing SearchResult shape */
export const PointsByWorkIdInput = z.object({ work_id: z.string() });
export type PointsByWorkIdInput = z.infer<typeof PointsByWorkIdInput>;

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
  lat: Latitude,
  lng: Longitude,
  radius_m: z.number().positive().finite(),
});
export type NearbyInput = z.infer<typeof NearbyInput>;

export const NearbyResult = z.object({
  rows: z.array(PilgrimagePoint),
});
export type NearbyResult = z.infer<typeof NearbyResult>;

/** geocode(query, limit?) -> { candidates } */
export const GeocodeKind = z.enum(["station", "city", "ward", "landmark", "prefecture"]);
export type GeocodeKind = z.infer<typeof GeocodeKind>;

export const GeocodeSource = z.enum(["seed", "mlit", "geonames", "manual"]);
export type GeocodeSource = z.infer<typeof GeocodeSource>;

export const GeocodeInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).default(5),
});
export type GeocodeInput = z.infer<typeof GeocodeInput>;

export const GeocodeCandidate = z.object({
  id: z.string(),
  label: z.string(),
  name: z.string(),
  lat: Latitude,
  lng: Longitude,
  kind: GeocodeKind,
  source: GeocodeSource,
  effective_radius_m: z.number().int().positive().optional(),
});
export type GeocodeCandidate = z.infer<typeof GeocodeCandidate>;

export const GeocodeResult = z.object({ candidates: z.array(GeocodeCandidate) });
export type GeocodeResult = z.infer<typeof GeocodeResult>;

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
  resolve: oc
    .route({ method: "POST", path: "/catalog/resolve", summary: "Resolve an anime title deterministically" })
    .input(ResolveInput)
    .output(ResolveOutcome),
  pointsByWorkId: oc
    .route({
      method: "POST",
      path: "/catalog/points-by-work-id",
      summary: "Fetch pilgrimage points by resolved work id",
    })
    .input(PointsByWorkIdInput)
    .output(SearchResult),
  spots: oc
    .route({ method: "POST", path: "/catalog/spots", summary: "Fetch a single pilgrimage point, optionally with distance" })
    .input(SpotsInput)
    .errors(pickCatalogErrors(["WORK_NOT_FOUND"]))
    .output(SpotsResult),
  nearby: oc
    .route({ method: "POST", path: "/catalog/nearby", summary: "Find pilgrimage points within a radius" })
    .input(NearbyInput)
    // Pure DB/PostGIS query: no upstream dependency, so no UPSTREAM_UNAVAILABLE.
    .output(NearbyResult),
  geocode: oc
    .route({
      method: "POST",
      path: "/catalog/geocode",
      summary: "Resolve a place name to coordinate candidates (local gazetteer)",
    })
    .input(GeocodeInput)
    .output(GeocodeResult),
  route: oc
    .route({ method: "POST", path: "/catalog/route", summary: "Plan an ordered, timed route over selected points" })
    .input(RouteInput)
    .errors(pickCatalogErrors(["ROUTE_TOO_MANY_CLUSTERS", "ROUTE_TOO_MANY_POINTS"]))
    .output(Route),
  ingest: oc
    .route({ method: "POST", path: "/catalog/ingest", summary: "Ingest a not-yet-cataloged work on demand by bangumi id" })
    .input(IngestInput)
    .errors(pickCatalogErrors(["UPSTREAM_UNAVAILABLE"]))
    .output(IngestResult),
};

export type CatalogContract = typeof catalogContract;
