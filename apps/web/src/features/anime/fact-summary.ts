import type {
  AnimeOverview,
  AnimeOverviewCircle,
  AnimeSampleRoute,
  AnimeScene,
} from "@animichi/contract";

/**
 * Pure derivations for the anime-page fact-summary block (SD-27 v1).
 *
 * Every field is computed from `AnimeOverview` alone — no data is introduced
 * that the public catalog contract does not already carry. The duration
 * estimate mirrors the route planner's normal-pacing dwell floor
 * (`computeDwellMinutes` base of 8 min/stop) plus its walk-leg buffer.
 */
const DWELL_FLOOR_MINUTES = 8;
const WALK_BUFFER_MINUTES = 15;
const TOP_CITY_LIMIT = 3;

export interface CityCount {
  readonly region: string;
  readonly count: number;
}

export interface FactSummary {
  readonly spotCount: number;
  readonly topCities: readonly CityCount[];
  readonly durationMinutes: number | null;
  readonly routeCount: number;
}

function topCities(circles: readonly AnimeOverviewCircle[]): CityCount[] {
  return [...circles]
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_CITY_LIMIT)
    .map((circle) => ({ region: circle.region, count: circle.count }));
}

function estimateDurationMinutes(routes: readonly AnimeSampleRoute[]): number | null {
  const largest = Math.max(0, ...routes.map((route) => route.point_ids.length));
  if (largest === 0) return null;
  return largest * DWELL_FLOOR_MINUTES + (largest - 1) * WALK_BUFFER_MINUTES;
}

export function buildFactSummary(overview: AnimeOverview): FactSummary {
  return {
    spotCount: overview.points_length,
    topCities: topCities(overview.circles),
    durationMinutes: estimateDurationMinutes(overview.sample_routes),
    routeCount: overview.sample_routes.length,
  };
}

/** 名場面 ranking: most-shot scenes first, defensively re-sorted client-side. */
export function rankScenes(scenes: readonly AnimeScene[]): AnimeScene[] {
  return [...scenes].sort((a, b) => b.shot_count - a.shot_count);
}
