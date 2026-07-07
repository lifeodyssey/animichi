/**
 * Deterministic route-planning kernel: greedy nearest-neighbor ordering +
 * timed-itinerary construction.
 *
 * This TS module is the single owner of route ordering and timed walking
 * estimates. Pure logic — no I/O, no DB, no LLM. Deterministic for a given
 * input. Walking durations apply a detour coefficient on top of raw haversine
 * distance divided by the nominal walking speed; reported distances remain raw
 * haversine.
 *
 * Output shapes match the oRPC contract (`packages/contract/src/models.ts`):
 * `TimedStop`, `TransitLeg`, `TimedItinerary`. Leg-cache integration and the
 * >10-point LLM area-split are handled by later cards — this is the kernel only.
 */

import type { LocationCluster } from "./clustering";
import { haversine } from "./geo";
import type { Pacing, TimedItinerary, TimedStop, TransitLeg } from "../types";

/**
 * The wire shapes this kernel produces (`TimedStop` / `TransitLeg` /
 * `TimedItinerary` / `Pacing`) live in `../types` — the single in-Worker mirror
 * of `packages/contract/src/models.ts`. `import type` erases at compile time, so
 * the contract's zod runtime stays out of the Worker bundle. Re-exported here so
 * existing kernel consumers keep importing them from `lib/route`.
 */
export type { Pacing, TimedItinerary, TimedStop, TransitLeg };

/** Cluster-center origin for nearest-neighbor start (the coordinate form of the
 * contract `Origin`). Mirrors Python `origin`. */
export interface Origin {
  lat: number;
  lng: number;
}

const DWELL_MULTIPLIERS: Record<Pacing, number> = {
  chill: 1.5,
  normal: 1,
  packed: 0.6,
};

const TRANSIT_BUFFERS: Record<Pacing, number> = {
  chill: 1.2,
  normal: 1,
  packed: 0.8,
};

const WALKING_SPEED_M_PER_MIN = 80;
const WALK_DETOUR_COEFFICIENT = 1.3;
const VALID_PACING: ReadonlySet<string> = new Set(["chill", "normal", "packed"]);

/** Maximum clusters the timed-itinerary kernel accepts. */
export const MAX_ITINERARY_CLUSTERS = 50;

/** Python `round()` — round-half-to-even (banker's), unlike `Math.round`. */
function pyRound(value: number, digits = 0): number {
  const f = 10 ** digits;
  const scaled = value * f;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  if (diff < 0.5) return floor / f;
  if (diff > 0.5) return (floor + 1) / f;
  return (floor % 2 === 0 ? floor : floor + 1) / f;
}

/** Distance from a cluster center to a fixed point — NN sort helper. */
function distTo(c: LocationCluster, lat: number, lng: number): number {
  return haversine(lat, lng, c.centerLat, c.centerLng);
}

/** Stable compare on (rounded distance, clusterId) — mirrors the Python key. */
function byDistThenId(lat: number, lng: number, digits: number) {
  return (a: LocationCluster, b: LocationCluster): number => {
    const da = pyRound(distTo(a, lat, lng), digits);
    const db = pyRound(distTo(b, lat, lng), digits);
    if (da !== db) return da - db;
    return a.clusterId.localeCompare(b.clusterId);
  };
}

/** Seed the NN walk: nearest-to-origin, else alphabetically-first clusterId. */
function seedOrder(clusters: LocationCluster[], origin?: Origin): LocationCluster[] {
  const remaining = [...clusters];
  if (origin) {
    remaining.sort(byDistThenId(origin.lat, origin.lng, 15));
  } else {
    remaining.sort((a, b) => a.clusterId.localeCompare(b.clusterId));
  }
  return remaining;
}

/** Pick the next cluster: nearest to `current`, ties broken by clusterId. */
function pickNext(remaining: LocationCluster[], current: LocationCluster): LocationCluster {
  remaining.sort(byDistThenId(current.centerLat, current.centerLng, 2));
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- remaining is non-empty (caller guarantees)
  const best = remaining[0]!;
  const bestDist = distTo(best, current.centerLat, current.centerLng);
  const tied = remaining.filter(
    (c) => Math.abs(distTo(c, current.centerLat, current.centerLng) - bestDist) < 0.01,
  );
  if (tied.length <= 1) return best;
  tied.sort((a, b) => a.clusterId.localeCompare(b.clusterId));
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- tied is non-empty (contains at least best)
  return tied[0]!;
}

/**
 * Greedy nearest-neighbor ordering of `clusters` on their centers.
 * Starts from the cluster nearest `origin` (or the alphabetically-first
 * `clusterId` when no origin), then repeatedly hops to the nearest remaining.
 */
export function orderNearestNeighbor(
  clusters: LocationCluster[],
  origin?: Origin,
): LocationCluster[] {
  if (clusters.length <= 1) return [...clusters];
  const remaining = seedOrder(clusters, origin);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- remaining is non-empty (length > 1 checked above)
  const result: LocationCluster[] = [remaining.shift()!];
  while (remaining.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- result starts with one element and only grows
    const next = pickNext(remaining, result.at(-1)!);
    remaining.splice(remaining.indexOf(next), 1);
    result.push(next);
  }
  return result;
}

/**
 * Estimated dwell minutes for a cluster: `base = max(photoCount*3, 8)`, scaled
 * by the pacing multiplier, then rounded via Python's `int(raw + 0.5)`.
 */
export function computeDwellMinutes(photoCount: number, pacing: Pacing): number {
  const base = Math.max(photoCount * 3, 8);
  return Math.floor(base * DWELL_MULTIPLIERS[pacing] + 0.5);
}

/** Add `minutes` to an "HH:MM" string, returning a new "HH:MM". */
function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const total = h * 60 + m + minutes;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Resolve a pacing string to a valid `Pacing`, defaulting to "normal". */
function safePacing(pacing: string): Pacing {
  return (VALID_PACING.has(pacing) ? pacing : "normal") as Pacing;
}

/** Difference in minutes between two "HH:MM" times. */
function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number) as [number, number];
  const [eh, em] = end.split(":").map(Number) as [number, number];
  return eh * 60 + em - (sh * 60 + sm);
}

/** Display name for a stop: first point's `name`, else the clusterId. */
function stopName(cluster: LocationCluster): string {
  const first = cluster.points[0] as { name?: unknown } | undefined;
  const name = first?.name;
  return typeof name === "string" && name ? name : cluster.clusterId;
}

/** Build one stop record for `cluster` arriving at `arrive`. */
function makeStop(cluster: LocationCluster, arrive: string, dwell: number): TimedStop {
  return {
    cluster_id: cluster.clusterId,
    name: stopName(cluster),
    arrive,
    depart: addMinutes(arrive, dwell),
    dwell_minutes: dwell,
    lat: cluster.centerLat,
    lng: cluster.centerLng,
    photo_count: cluster.photoCount,
  };
}

/** Build the walk leg from `from` to `to`, given the pacing buffer. */
function makeLeg(from: LocationCluster, to: LocationCluster, buffer: number): TransitLeg {
  const dist = haversine(from.centerLat, from.centerLng, to.centerLat, to.centerLng);
  const estimate = (dist * WALK_DETOUR_COEFFICIENT) / WALKING_SPEED_M_PER_MIN;
  return {
    from_id: from.clusterId,
    to_id: to.clusterId,
    mode: "walk",
    duration_minutes: Math.max(1, pyRound(estimate * buffer)),
    distance_m: pyRound(dist, 1),
  };
}

/** Options for {@link buildTimedItinerary}. */
export interface ItineraryOptions {
  startTime?: string;
  pacing?: string;
  origin?: Origin;
}

/**
 * Build a `TimedItinerary` from `clusters`: order them by nearest-neighbor,
 * then walk through producing stops (arrive/depart/dwell), legs (walk distance
 * via raw haversine + detoured duration estimate), and totals. Throws when
 * given over {@link MAX_ITINERARY_CLUSTERS} clusters.
 */
export function buildTimedItinerary(
  clusters: LocationCluster[],
  opts: ItineraryOptions = {},
): TimedItinerary {
  if (clusters.length > MAX_ITINERARY_CLUSTERS) {
    throw new Error(`Too many locations to route (max ${String(MAX_ITINERARY_CLUSTERS)})`);
  }
  const startTime = opts.startTime ?? "09:00";
  const pacing = safePacing(opts.pacing ?? "normal");
  if (clusters.length === 0) {
    return { stops: [], legs: [], total_minutes: 0, total_distance_m: 0, pacing, start_time: startTime };
  }
  return assembleItinerary(orderNearestNeighbor(clusters, opts.origin), startTime, pacing);
}

/** Walk the ordered clusters, accumulating stops, legs, and totals. */
function assembleItinerary(
  ordered: LocationCluster[],
  startTime: string,
  pacing: Pacing,
): TimedItinerary {
  const buffer = TRANSIT_BUFFERS[pacing];
  const stops: TimedStop[] = [];
  const legs: TransitLeg[] = [];
  let totalDistance = 0;
  let currentTime = startTime;
  for (let i = 0; i < ordered.length; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index bounded by loop [0, ordered.length)
    const cluster = ordered[i]!;
    const stop = makeStop(cluster, currentTime, computeDwellMinutes(cluster.photoCount, pacing));
    stops.push(stop);
    if (i < ordered.length - 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- i+1 < ordered.length is guaranteed by the if condition
      const next = ordered[i + 1]!;
      const leg = makeLeg(cluster, next, buffer);
      legs.push(leg);
      totalDistance += haversine(cluster.centerLat, cluster.centerLng, next.centerLat, next.centerLng);
      currentTime = addMinutes(stop.depart, leg.duration_minutes);
    }
  }
  return finalizeItinerary(stops, legs, totalDistance, startTime, pacing);
}

/** Compute totals and assemble the final `TimedItinerary`. */
function finalizeItinerary(
  stops: TimedStop[],
  legs: TransitLeg[],
  totalDistance: number,
  startTime: string,
  pacing: Pacing,
): TimedItinerary {
  return {
    stops,
    legs,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- stops is non-empty (assembleItinerary adds at least one stop)
    total_minutes: minutesBetween(stops[0]!.arrive, stops.at(-1)!.depart),
    total_distance_m: pyRound(totalDistance, 1),
    spot_count: stops.length,
    pacing,
    start_time: startTime,
  };
}
