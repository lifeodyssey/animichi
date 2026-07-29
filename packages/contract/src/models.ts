/**
 * Shared cross-service models as Zod schemas + inferred TS types.
 *
 * Single source of truth for the types exchanged between the Python Agent
 * service (client) and the TS Catalog service (server). Field names mirror the
 * existing Python shapes:
 *   - backend/agents/runtime_models.py  (PilgrimagePointModel, RouteModel)
 *   - backend/agents/models.py          (TimedStop, TransitLeg, TimedItinerary)
 */

import { z } from "zod";
import { MAX_CANDIDATES } from "./constants.js";

export const Latitude = z.number().min(-90).max(90);
export const Longitude = z.number().min(-180).max(180);

/** A geographic origin: either lat/lng coordinates or a named place string. */
export const LatLng = z.object({
  lat: Latitude,
  lng: Longitude,
});
export type LatLng = z.infer<typeof LatLng>;

export const Origin = z.union([LatLng, z.string()]);
export type Origin = z.infer<typeof Origin>;

/** Pacing for route itineraries. Matches TimedItinerary.pacing in models.py. */
export const Pacing = z.enum(["chill", "normal", "packed"]);
export type Pacing = z.infer<typeof Pacing>;

/**
 * A single pilgrimage point row.
 * Mirrors PilgrimagePointModel in runtime_models.py.
 */
export const PilgrimagePoint = z.object({
  id: z.string(),
  name: z.string(),
  name_cn: z.string().optional(),
  bangumi_id: z.string(),
  episode: z.number().int().optional(),
  time_seconds: z.number().int().optional(),
  screenshot_url: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  title: z.string().optional(),
  title_cn: z.string().optional(),
  distance_m: z.number().optional(),
  origin: z.string().optional(),
  cover_url: z.string().optional(),
  city: z.string().optional(),
});
export type PilgrimagePoint = z.infer<typeof PilgrimagePoint>;

/**
 * One region bubble for the public anime overview: a place name, its spot count,
 * and the centroid coordinate the bubble map renders at. Public catalog data
 * only — no user or internal pipeline fields.
 */
export const AnimeOverviewCircle = z.object({
  region: z.string(),
  count: z.number().int().nonnegative(),
  lat: Latitude,
  lng: Longitude,
});
export type AnimeOverviewCircle = z.infer<typeof AnimeOverviewCircle>;

/**
 * One 名場面 (famous scene) in the public shot-count ranking: the representative
 * point of a co-located cluster, its thumbnail, and how many shots it aggregates.
 */
export const AnimeScene = z.object({
  id: z.string(),
  name: z.string(),
  screenshot_url: z.string().nullable(),
  shot_count: z.number().int().nonnegative(),
  lat: Latitude,
  lng: Longitude,
  city: z.string().optional(),
});
export type AnimeScene = z.infer<typeof AnimeScene>;

/** A suggested per-region sample route: the region name plus its member point ids. */
export const AnimeSampleRoute = z.object({
  region: z.string(),
  point_ids: z.array(z.string()),
});
export type AnimeSampleRoute = z.infer<typeof AnimeSampleRoute>;

/**
 * The public anime overview payload: bubble aggregation, 名場面 ranking, and
 * sample routes for one work. Exposed anonymously (catalog's first public
 * surface) — every field is derived from already-public catalog data.
 */
export const AnimeOverview = z.object({
  bangumi_id: z.string(),
  points_length: z.number().int().nonnegative(),
  circles: z.array(AnimeOverviewCircle),
  scenes: z.array(AnimeScene),
  sample_routes: z.array(AnimeSampleRoute),
});
export type AnimeOverview = z.infer<typeof AnimeOverview>;

/** Stable catalog identity and trusted display metadata for one anime work. */
export const AnimeCandidate = z.object({
  bangumi_id: z.string(),
  title: z.string(),
  title_cn: z.string().optional(),
  cover_url: z.string().optional(),
  year: z.number().int().optional(),
  points_count: z.number().int().nonnegative().optional(),
});
export type AnimeCandidate = z.infer<typeof AnimeCandidate>;

/** Deterministic catalog resolution partition over a free-text anime title. */
export const ResolveOutcome = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("resolved"), match: AnimeCandidate }),
  z.object({
    outcome: z.literal("needs_disambiguation"),
    reason: z.literal("anime_ambiguity"),
    candidates: z.array(AnimeCandidate).min(2).max(MAX_CANDIDATES),
  }),
  z.object({ outcome: z.literal("not_found"), reason: z.literal("anime_not_found") }),
  z.object({
    outcome: z.literal("upstream_unavailable"),
    provider: z.enum(["bangumi", "anitabi"]),
  }),
]);
export type ResolveOutcome = z.infer<typeof ResolveOutcome>;

/**
 * A stop on the route with arrival/departure times and dwell duration.
 * Mirrors TimedStop in models.py.
 */
export const TimedStop = z.object({
  cluster_id: z.string(),
  name: z.string(),
  arrive: z.string(), // "HH:MM"
  depart: z.string(), // "HH:MM"
  dwell_minutes: z.number().int(),
  lat: z.number(),
  lng: z.number(),
  photo_count: z.number().int(),
});
export type TimedStop = z.infer<typeof TimedStop>;

/**
 * A transit segment between two stops.
 * Mirrors TransitLeg in models.py.
 */
export const TransitLeg = z.object({
  from_id: z.string(),
  to_id: z.string(),
  mode: z.enum(["walk", "transit"]),
  duration_minutes: z.number().int(),
  distance_m: z.number(),
  line_names: z.array(z.string()).optional(),
  transfers: z.number().int().optional(),
  board_station: z.string().optional(),
  alight_station: z.string().optional(),
  summary: z.string().optional(),
  attribution: z.array(z.string()).optional(),
});
export type TransitLeg = z.infer<typeof TransitLeg>;

/**
 * Complete timed route with stops, transit legs, and export data.
 * Mirrors TimedItinerary in models.py.
 */
export const TimedItinerary = z.object({
  stops: z.array(TimedStop),
  legs: z.array(TransitLeg),
  total_minutes: z.number().int(),
  total_distance_m: z.number(),
  spot_count: z.number().int().optional(),
  pacing: Pacing.optional(),
  start_time: z.string().optional(), // "HH:MM"
  // Two distinct export fields, mirroring TimedItinerary in models.py:
  //   - export_google_maps_url: a list of Google Maps deep-link URLs
  //   - export_ics: an iCalendar document as a string (NOT a URL)
  export_google_maps_url: z.array(z.string()).optional(),
  export_ics: z.string().optional(),
});
export type TimedItinerary = z.infer<typeof TimedItinerary>;

/**
 * Outcome of an on-demand ingest call.
 * Discriminated union over `status`, mirroring `IngestResult` in
 * catalog/src/ingest/orchestrator.ts. `version` + `point_count` are present only
 * for `ingested`; `reason` carries the cause for `empty` / `failed`.
 */
export const IngestResult = z.object({
  status: z.enum(["ingested", "in_progress", "empty", "failed"]),
  version: z.number().int().optional(),
  point_count: z.number().int().optional(),
  reason: z.string().optional(),
});
export type IngestResult = z.infer<typeof IngestResult>;

/**
 * An ordered, timed pilgrimage route.
 * Mirrors RouteModel in runtime_models.py.
 */
export const Route = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  ordered_points: z.array(PilgrimagePoint),
  point_count: z.number().int(),
  cover_url: z.string().optional(),
  anime_title: z.string().optional(),
  anime_title_cn: z.string().optional(),
  truncated: z.boolean().optional(),
  shown_cluster_count: z.number().int().optional(),
  total_cluster_count: z.number().int().optional(),
  timed_itinerary: TimedItinerary,
});
export type Route = z.infer<typeof Route>;
