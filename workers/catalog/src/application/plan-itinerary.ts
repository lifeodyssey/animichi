/**
 * `planItinerary` application use case: plan an ordered, timed route over
 * selected points. Orchestration only — the pure W2-1 kernel
 * (`domain/itinerary/plan.ts`: cluster -> nearest-neighbor order -> timed
 * itinerary) does the planning; points arrive through the `PointsForRoutePort`
 * outbound port, adapted to the data layer by the caller. No I/O, no SQL here.
 *
 * Flow: `port.loadPoints(point_ids)` -> `clusterByLocation` (50m) ->
 * deterministic 50-cluster cap -> `buildTimedItinerary` -> expand the ordered
 * clusters back to their member points (= `ordered_points`) -> `Itinerary`.
 *
 * Origin is forwarded to the kernel only in `{lat,lng}` form; the contract's
 * named-place string Origin would need geocoding first (a follow-up, alongside
 * the `leg_cache` pre-warmed walk durations the kernel currently derives from
 * haversine).
 *
 * Observability: `ItineraryObserverPort` records a redacted observation —
 * outcome, point/cluster counts, truncation, duration — never coordinates or
 * titles.
 */

import type { ClusterablePoint, LocationCluster } from "../domain/clustering/cluster";
import { clusterByLocation } from "../domain/clustering/cluster";
import type { Origin as KernelOrigin, TimedItinerary } from "../domain/itinerary/plan";
import { buildTimedItinerary, MAX_ITINERARY_CLUSTERS } from "../domain/itinerary/plan";
import { optional } from "../lib/optional";
import type { Origin, Pacing, Point, Itinerary } from "../types";

/** An itinerary point: the contract `Point` + the geo fields clustering needs. */
export type ItineraryPoint = Point & ClusterablePoint;

/** A cluster whose members are full route points (for `ordered_points`). */
type PointCluster = LocationCluster<ItineraryPoint>;

/** Outbound capability the use case needs: load the points for route `ids`. */
export interface PointsForRoutePort {
  loadPoints(ids: string[]): Promise<ItineraryPoint[]>;
}

/** Inputs for {@link planItinerary} — mirrors `ItineraryInput` in the contract. */
export interface ItineraryInput {
  point_ids: string[];
  origin?: Origin;
  pacing?: Pacing;
}

/** Redacted itinerary observation: outcome, counts, truncation, duration — never coordinates/titles. */
export interface ItineraryObservation {
  outcome: "planned" | "empty";
  point_count: number;
  cluster_count: number;
  truncated: boolean;
  duration_ms: number;
}

export interface ItineraryObserverPort {
  record(observation: ItineraryObservation): void;
}

/** Injectable clock so duration is deterministic in tests. */
export interface ItineraryClock {
  now(): number;
}

export interface ItineraryOptions {
  observer?: ItineraryObserverPort;
  clock?: ItineraryClock;
}

/** Plan an ordered, timed route over `point_ids`. Empty/unknown ids -> count 0. */
export async function planItinerary(port: PointsForRoutePort, input: ItineraryInput, opts: ItineraryOptions = {}): Promise<Itinerary> {
  const clock = opts.clock ?? realClock;
  const started = clock.now();
  const points = await port.loadPoints(input.point_ids);
  const allClusters = clusterByLocation(points, 50);
  const clusters = allClusters.slice(0, MAX_ITINERARY_CLUSTERS);
  const itinerary = buildTimedItinerary(clusters, kernelOpts(input));
  const result = assembleRoute(clusters, itinerary, allClusters.length);
  recordIfObserved(opts, result, clusters.length, started, clock.now());
  return result;
}

/** Kernel itinerary options: pacing + the coordinate form of Origin only. */
function kernelOpts(input: ItineraryInput): { pacing?: Pacing; origin?: KernelOrigin } {
  const origin = typeof input.origin === "object" ? input.origin : undefined;
  return { pacing: input.pacing, origin };
}

/** Assemble the contract `Itinerary` from the ordered clusters and the timed itinerary. */
function assembleRoute(clusters: PointCluster[], itinerary: TimedItinerary, totalClusters: number): Itinerary {
  const ordered = orderPoints(clusters, itinerary);
  return { ...animeMeta(ordered[0]), ...truncationMeta(clusters.length, totalClusters), ordered_points: ordered, point_count: ordered.length, timed_itinerary: itinerary };
}

/** Add disclosure fields only when the deterministic cluster cap was applied. */
function truncationMeta(shown: number, total: number): Partial<Pick<Itinerary, "truncated" | "shown_cluster_count" | "total_cluster_count">> {
  if (shown === total) return {};
  return { truncated: true, shown_cluster_count: shown, total_cluster_count: total };
}

/** Expand the itinerary's ordered stops back to their member points, in order. */
function orderPoints(clusters: PointCluster[], itinerary: TimedItinerary): Point[] {
  const byCluster = new Map(clusters.map((c) => [c.clusterId, c]));
  return itinerary.stops.flatMap((s) => byCluster.get(s.cluster_id)?.points ?? []);
}

/** The anime-title metadata carried on the Itinerary, taken from the lead point. */
function animeMeta(lead?: Point): Pick<Itinerary, "anime_title" | "anime_title_cn" | "cover_url"> {
  return optional({
    anime_title: lead?.title,
    anime_title_cn: lead?.title_cn,
    cover_url: lead?.cover_url,
  });
}

/** Record the redacted observation; duration is the injected clock's span. */
function recordIfObserved(
  opts: ItineraryOptions,
  result: Itinerary,
  clusterCount: number,
  started: number,
  finished: number,
): void {
  opts.observer?.record({
    outcome: result.point_count === 0 ? "empty" : "planned",
    point_count: result.point_count,
    cluster_count: clusterCount,
    truncated: result.truncated ?? false,
    duration_ms: Math.max(0, finished - started),
  });
}

const realClock: ItineraryClock = { now: () => Date.now() };
