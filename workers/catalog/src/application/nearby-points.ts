/**
 * `nearby` application use case (card CATALOG-3): pilgrimage points within a
 * radius of a coordinate, nearest first. Orchestration only — the PostGIS read
 * arrives through the `NearbyPointsPort` and detail enrichment through
 * `PointDetailsPort` (both adapted in `adapters/outbound/nearby-points.ts`).
 * No I/O, no SQL here.
 *
 * Policy owned by this use case, not the transport or the adapter: radius
 * validation (non-positive radii are rejected; radii over `MAX_RADIUS_M` are
 * clamped, never widened) and deterministic distance ordering (distance asc,
 * id asc on ties). Empty results are typed (`{ rows: [] }`), never null.
 *
 * Observability: `NearbyObserverPort` records a redacted observation — radius
 * bucket, count, outcome, duration — never coordinates.
 */

import { optional } from "../lib/optional";
import type { Point } from "../types";

/** Hard ceiling on the searched radius; larger requests are clamped, not rejected. */
export const MAX_RADIUS_M = 50_000;

/** One geo hit: enough to order and merge; coordinates are never observed. */
export interface NearbyPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceM: number;
}

/** The point-detail columns a geo hit omits, keyed by id for the merge. */
export interface PointDetail {
  id: string;
  bangumi_id: string | null;
  name_cn: string | null;
  image: string | null;
  episode: number | null;
  time_seconds: number | null;
  origin: string | null;
  city?: string | null;
}

/** Outbound capability: points within `radiusM` meters of (lat, lng). */
export interface NearbyPointsPort {
  pointsWithin(lat: number, lng: number, radiusM: number): Promise<NearbyPoint[]>;
}

/** Outbound capability: the detail columns for `ids` (absent ids are missing). */
export interface PointDetailsPort {
  detailsFor(ids: string[]): Promise<Map<string, PointDetail>>;
}

/** Coarse radius bucket for observability — never the raw value or coordinates. */
export type RadiusBucket = "lt-1km" | "1km-10km" | "10km-50km" | "over-cap";

/** Redacted nearby observation: radius bucket, count, outcome, duration. */
export interface NearbyObservation {
  radius_bucket: RadiusBucket;
  count: number;
  outcome: "ok" | "db_error";
  duration_ms: number;
}

/** Outbound capability: record one redacted observation (no-op when absent). */
export interface NearbyObserverPort {
  record(observation: NearbyObservation): void;
}

/** Injectable clock so durations are deterministic in tests. */
export interface NearbyClock {
  now(): number;
}

/** Inputs for {@link nearbyPoints} — mirrors `NearbyInput` in the contract. */
export interface NearbyPointsInput {
  lat: number;
  lng: number;
  radius_m: number;
}

export interface NearbyPointsOptions {
  observer?: NearbyObserverPort;
  clock?: NearbyClock;
}

/** Radius outside the use case's policy — rejected, never clamped. */
export class InvalidRadiusError extends Error {
  constructor(radiusM: number) {
    super(`radius_m must be positive, got ${String(radiusM)}`);
    this.name = "InvalidRadiusError";
  }
}

/** Points within `input.radius_m` meters of (lat, lng), nearest first, with `distance_m`. */
export async function nearbyPoints(
  geo: NearbyPointsPort,
  details: PointDetailsPort,
  input: NearbyPointsInput,
  opts: NearbyPointsOptions = {},
): Promise<{ rows: Point[] }> {
  const clock = opts.clock ?? realClock;
  const started = clock.now();
  const radius = validatedRadius(input.radius_m);
  try {
    const rows = await mergedRows(geo, details, input, radius);
    observeOk(opts.observer, input.radius_m, rows.length, clock.now() - started);
    return { rows };
  } catch (err) {
    observeError(opts.observer, input.radius_m, clock.now() - started);
    throw err;
  }
}

/** Load, order, and enrich: the pipeline behind one nearby response. */
async function mergedRows(
  geo: NearbyPointsPort,
  details: PointDetailsPort,
  input: NearbyPointsInput,
  radiusM: number,
): Promise<Point[]> {
  const near = sortByDistance(await geo.pointsWithin(input.lat, input.lng, radiusM));
  const byId = await details.detailsFor(near.map((point) => point.id));
  return near.map((point) => merge(point, byId.get(point.id)));
}

/** Apply the radius policy: reject non-positive; clamp over-cap, never widen. */
function validatedRadius(radiusM: number): number {
  if (radiusM <= 0) throw new InvalidRadiusError(radiusM);
  return Math.min(radiusM, MAX_RADIUS_M);
}

/** Deterministic nearest-first order: distance asc, id asc on ties. */
function sortByDistance(points: NearbyPoint[]): NearbyPoint[] {
  return [...points].sort(compareDistance);
}

function compareDistance(left: NearbyPoint, right: NearbyPoint): number {
  const byDistance = left.distanceM - right.distanceM;
  if (byDistance !== 0) return byDistance;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

/** Merge a geo hit with its detail row into a contract `Point`. */
function merge(near: NearbyPoint, detail: PointDetail | undefined): Point {
  return { ...baseFields(near, detail), ...optional(optionals(detail)) };
}

/** The required `Point` fields; absent detail rows keep the sentinel defaults. */
function baseFields(near: NearbyPoint, detail: PointDetail | undefined): Point {
  return {
    id: near.id,
    name: near.name,
    bangumi_id: detail?.bangumi_id ?? "",
    screenshot_url: detail?.image ?? "",
    latitude: near.latitude,
    longitude: near.longitude,
    distance_m: near.distanceM,
  };
}

/** The optional `Point` fields, present only when the detail row has them. */
function optionals(detail: PointDetail | undefined): Record<string, unknown> {
  return {
    name_cn: detail?.name_cn,
    episode: detail?.episode,
    time_seconds: detail?.time_seconds,
    origin: detail?.origin,
    city: detail?.city,
  };
}

/** Record the ok observation; the duration is the injected clock's span. */
function observeOk(observer: NearbyObserverPort | undefined, radiusM: number, count: number, durationMs: number): void {
  observer?.record({
    radius_bucket: bucket(radiusM),
    count,
    outcome: "ok",
    duration_ms: Math.max(0, durationMs),
  });
}

/** Record the db-error observation; the caller rethrows. */
function observeError(observer: NearbyObserverPort | undefined, radiusM: number, durationMs: number): void {
  observer?.record({
    radius_bucket: bucket(radiusM),
    count: 0,
    outcome: "db_error",
    duration_ms: Math.max(0, durationMs),
  });
}

/** Coarse radius buckets for observability — never the raw radius. */
function bucket(radiusM: number): RadiusBucket {
  if (radiusM < 1_000) return "lt-1km";
  if (radiusM < 10_000) return "1km-10km";
  if (radiusM <= MAX_RADIUS_M) return "10km-50km";
  return "over-cap";
}

const realClock: NearbyClock = { now: () => Date.now() };
