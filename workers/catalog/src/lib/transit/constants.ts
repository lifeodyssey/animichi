import type { RailCategory } from "./model";

/** Average scheduled rail speeds in km/h, including stops. */
export const CATEGORY_SPEED_KMH: Readonly<Record<RailCategory, number>> = {
  shinkansen: 180,
  jr_conventional: 45,
  private_rail: 40,
  subway: 30,
  tram: 15,
};

/** Fixed interchange friction in minutes. */
export const TRANSFER_PENALTY_MIN = 5;
/** Expected platform wait in minutes, charged initially and per transfer. */
export const EXPECTED_WAIT_MIN = 4;
/** Typical walking speed in metres per minute. */
export const WALKING_SPEED_M_PER_MIN = 80;
/** Straight-line to walking-route distance multiplier. */
export const WALK_DETOUR_COEFFICIENT = 1.3;
/** Walking-time threshold above which transit is considered. */
export const TRANSIT_WALK_THRESHOLD_MIN = 25;
/** Straight-line threshold above which transit is considered. */
export const TRANSIT_DISTANCE_THRESHOLD_M = 1500;
/** Maximum straight-line distance from a coordinate to a station. */
export const NEAREST_STATION_MAX_M = 3000;

export function isTransitCandidate(straightLineDistanceM: number): boolean {
  const walkingMinutes = straightLineDistanceM * WALK_DETOUR_COEFFICIENT / WALKING_SPEED_M_PER_MIN;
  return walkingMinutes > TRANSIT_WALK_THRESHOLD_MIN || straightLineDistanceM > TRANSIT_DISTANCE_THRESHOLD_M;
}
