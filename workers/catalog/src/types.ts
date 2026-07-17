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

export type GeocodeKind = "station" | "city" | "ward" | "landmark" | "prefecture";
export type GeocodeSource = "seed" | "mlit" | "geonames" | "manual";

export interface GeocodeInput {
  query: string;
  limit: number;
}

export interface GeocodeCandidate {
  id: string;
  label: string;
  name: string;
  lat: number;
  lng: number;
  kind: GeocodeKind;
  source: GeocodeSource;
  effective_radius_m?: number;
}

export interface GeocodeResult {
  candidates: GeocodeCandidate[];
}

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
  city?: string;
}

/** Stable anime identity and trusted display metadata — mirrors `AnimeCandidate`. */
export interface AnimeCandidate {
  bangumi_id: string;
  title: string;
  title_cn?: string;
  cover_url?: string;
  year?: number;
  points_count?: number;
}

/** Deterministic title-resolution partition — mirrors `ResolveOutcome`. */
export type ResolveOutcome =
  | { outcome: "resolved"; match: AnimeCandidate }
  | {
    outcome: "needs_disambiguation";
    reason: "anime_ambiguity";
    candidates: AnimeCandidate[];
  }
  | { outcome: "not_found"; reason: "anime_not_found" }
  | { outcome: "upstream_unavailable"; provider: "bangumi" | "anitabi" };

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

/** A segment between two stops — mirrors `TransitLeg`. */
export interface TransitLeg {
  from_id: string;
  to_id: string;
  mode: "walk" | "transit";
  duration_minutes: number;
  distance_m: number;
  line_names?: string[];
  transfers?: number;
  board_station?: string;
  alight_station?: string;
  summary?: string;
  attribution?: string[];
}

/**
 * The `search` response — mirrors `SearchResult` in the contract.
 *
 * `partial` is set when `rows` are an L1 preview (the first ~10 points from the
 * Anitabi `/lite` endpoint, returned immediately while the full ingest runs in
 * the background) rather than the work's fully-published point set. Absent on a
 * normal alias-hit response.
 */
export interface SearchResult {
  rows: PilgrimagePoint[];
  synced_at: string;
  partial?: boolean;
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
