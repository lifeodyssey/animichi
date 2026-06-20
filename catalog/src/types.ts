/**
 * Catalog wire types — the request/response shapes the read API exchanges with
 * the Python Agent client, mirroring `packages/contract/src/models.ts`
 * field-for-field.
 *
 * TYPE-ONLY module: pure `interface` / `type` declarations, NO zod import and no
 * runtime values. Consumers `import type` from here, so this file is erased at
 * compile time — the contract's zod runtime never enters the Worker bundle. It
 * is the single in-Worker mirror of the contract; the handlers, router, and the
 * route kernel all import these instead of re-declaring them (the shapes had
 * already drifted when each module owned its own copy).
 *
 * MUST stay in lockstep with packages/contract/src/models.ts.
 */

/** A geographic origin: lat/lng coordinates or a named place string. Mirrors `Origin`. */
export type Origin = { lat: number; lng: number } | string;

/** Pacing for route itineraries — mirrors `Pacing` in the contract. */
export type Pacing = "chill" | "normal" | "packed";

/** A single pilgrimage point row — mirrors `PilgrimagePoint` in the contract. */
export interface PilgrimagePoint {
  id: string;
  name: string;
  name_cn?: string;
  bangumi_id: string;
  episode?: number;
  time_seconds?: number;
  screenshot_url: string;
  latitude: number;
  longitude: number;
  title?: string;
  title_cn?: string;
  distance_m?: number;
  origin?: string;
  cover_url?: string;
}

/** A stop with arrival/departure + dwell — mirrors `TimedStop`. */
export interface TimedStop {
  cluster_id: string;
  name: string;
  arrive: string; // "HH:MM"
  depart: string; // "HH:MM"
  dwell_minutes: number;
  lat: number;
  lng: number;
  photo_count: number;
}

/** A walk segment between two stops — mirrors `TransitLeg`. */
export interface TransitLeg {
  from_id: string;
  to_id: string;
  mode: "walk";
  duration_minutes: number;
  distance_m: number;
}

/** A complete timed route — mirrors `TimedItinerary`. */
export interface TimedItinerary {
  stops: TimedStop[];
  legs: TransitLeg[];
  total_minutes: number;
  total_distance_m: number;
  spot_count?: number;
  pacing?: Pacing;
  start_time?: string; // "HH:MM"
  export_google_maps_url?: string[];
  export_ics?: string;
}

/**
 * Outcome of an on-demand ingest — mirrors `IngestResult` in the contract.
 *
 * This is the WIRE shape (snake_case `point_count`), distinct from the
 * orchestrator's internal `IngestResult` (camelCase `pointCount`); the router
 * maps the orchestrator union onto this flat object before serializing.
 */
export interface IngestResult {
  status: "ingested" | "in_progress" | "empty" | "failed";
  version?: number;
  point_count?: number;
  reason?: string;
}

/** An ordered, timed pilgrimage route — mirrors `Route` in the contract. */
export interface Route {
  id?: string;
  version?: string;
  ordered_points: PilgrimagePoint[];
  point_count: number;
  cover_url?: string;
  anime_title?: string;
  anime_title_cn?: string;
  timed_itinerary: TimedItinerary;
}
