/**
 * `planItinerary` application use case: plan an ordered, timed route over
 * selected points. Orchestration only — the pure W2-1 kernel
 * (`domain/itinerary/plan.ts`: cluster -> nearest-neighbor order -> timed
 * itinerary) does the planning; points arrive through the `PointsForRoutePort`
 * outbound port, adapted to the data layer by the caller. No I/O, no SQL here.
 *
 * Flow: `port.loadPoints(point_ids)` -> `clusterByLocation` (50m) ->
 * deterministic 50-cluster cap -> `buildTimedItinerary` -> expand the ordered
 * clusters back to their member points (= `ordered_points`) -> `Route`.
 *
 * Origin is forwarded to the kernel only in `{lat,lng}` form; the contract's
 * named-place string Origin would need geocoding first (a follow-up, alongside
 * the `leg_cache` pre-warmed walk durations the kernel currently derives from
 * haversine).
 */

import type { ClusterablePoint, LocationCluster } from "../domain/clustering/cluster";
import { clusterByLocation } from "../domain/clustering/cluster";
import type { Origin as KernelOrigin, TimedItinerary } from "../domain/itinerary/plan";
import { buildTimedItinerary, MAX_ITINERARY_CLUSTERS } from "../domain/itinerary/plan";
import { optional } from "../lib/optional";
import type { Origin, Pacing, PilgrimagePoint, Route } from "../types";

/** A route point: the contract `PilgrimagePoint` + the geo fields clustering needs. */
export type RoutePoint = PilgrimagePoint & ClusterablePoint;

/** A cluster whose members are full route points (for `ordered_points`). */
type PointCluster = LocationCluster<RoutePoint>;

/** Outbound capability the use case needs: load the points for route `ids`. */
export interface PointsForRoutePort {
  loadPoints(ids: string[]): Promise<RoutePoint[]>;
}

/** Inputs for {@link planItinerary} — mirrors `RouteInput` in the contract. */
export interface RouteInput {
  point_ids: string[];
  origin?: Origin;
  pacing?: Pacing;
}

/** Plan an ordered, timed route over `point_ids`. Empty/unknown ids -> count 0. */
export async function planItinerary(port: PointsForRoutePort, input: RouteInput): Promise<Route> {
  const points = await port.loadPoints(input.point_ids);
  const allClusters = clusterByLocation(points, 50);
  const clusters = allClusters.slice(0, MAX_ITINERARY_CLUSTERS);
  const itinerary = buildTimedItinerary(clusters, kernelOpts(input));
  return assembleRoute(clusters, itinerary, allClusters.length);
}

/** Kernel itinerary options: pacing + the coordinate form of Origin only. */
function kernelOpts(input: RouteInput): { pacing?: Pacing; origin?: KernelOrigin } {
  const origin = typeof input.origin === "object" ? input.origin : undefined;
  return { pacing: input.pacing, origin };
}

/** Assemble the contract `Route` from the ordered clusters and the itinerary. */
function assembleRoute(clusters: PointCluster[], itinerary: TimedItinerary, totalClusters: number): Route {
  const ordered = orderPoints(clusters, itinerary);
  return { ...animeMeta(ordered[0]), ...truncationMeta(clusters.length, totalClusters), ordered_points: ordered, point_count: ordered.length, timed_itinerary: itinerary };
}

/** Add disclosure fields only when the deterministic cluster cap was applied. */
function truncationMeta(shown: number, total: number): Partial<Pick<Route, "truncated" | "shown_cluster_count" | "total_cluster_count">> {
  if (shown === total) return {};
  return { truncated: true, shown_cluster_count: shown, total_cluster_count: total };
}

/** Expand the itinerary's ordered stops back to their member points, in order. */
function orderPoints(clusters: PointCluster[], itinerary: TimedItinerary): PilgrimagePoint[] {
  const byCluster = new Map(clusters.map((c) => [c.clusterId, c]));
  return itinerary.stops.flatMap((s) => byCluster.get(s.cluster_id)?.points ?? []);
}

/** The anime-title metadata carried on the Route, taken from the lead point. */
function animeMeta(lead?: PilgrimagePoint): Pick<Route, "anime_title" | "anime_title_cn" | "cover_url"> {
  return optional({
    anime_title: lead?.title,
    anime_title_cn: lead?.title_cn,
    cover_url: lead?.cover_url,
  });
}
