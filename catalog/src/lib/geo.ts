/**
 * Pure geometric helpers — haversine distance.
 *
 * Faithful TS port of `backend/agents/geo_utils.py::haversine_distance`.
 * No I/O, no side effects. Deterministic.
 */

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance in **meters** between two WGS-84 points.
 *
 * Mirrors the Python implementation exactly:
 *   a = sin(dlat/2)^2 + cos(lat1)*cos(lat2)*sin(dlon/2)^2
 *   d = 2 * R * asin(sqrt(a))
 */
export function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const rlat1 = toRadians(lat1);
  const rlat2 = toRadians(lat2);
  const dlat = toRadians(lat2 - lat1);
  const dlon = toRadians(lng2 - lng1);
  const a =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(dlon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}
