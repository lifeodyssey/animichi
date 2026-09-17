/**
 * Publishable spot coordinates (X15 #285).
 *
 * The coordinate validity specification the publish-stage quality gate
 * applies before a spot row may enter a public snapshot: WGS-84
 * latitude/longitude within their hemispherical bounds and OFF null island
 * (0,0) — the sentinel of an un-geocoded row. A row that fails the
 * specification is rejected at publish and never flows into a public page.
 */

/** A spot's geographic position in degrees, as stored on the row. */
export interface SpotCoordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/** Inclusive WGS-84 latitude bounds. */
export const MIN_LATITUDE = -90;
export const MAX_LATITUDE = 90;

/** Inclusive WGS-84 longitude bounds. */
export const MIN_LONGITUDE = -180;
export const MAX_LONGITUDE = 180;

/** Null island (0,0): the "no real position" sentinel, never a pilgrimage site. */
export function isNullIsland(coordinates: SpotCoordinates): boolean {
  return coordinates.latitude === 0 && coordinates.longitude === 0;
}

/** Whether the coordinates lie within WGS-84 bounds and off null island. */
export function isPublishableSpotCoordinates(coordinates: SpotCoordinates): boolean {
  return inRange(coordinates.latitude, MIN_LATITUDE, MAX_LATITUDE)
    && inRange(coordinates.longitude, MIN_LONGITUDE, MAX_LONGITUDE)
    && !isNullIsland(coordinates);
}

/** Finite numeric containment in [min, max]; NaN and infinities never pass. */
function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}
