/**
 * Inbound transport for the `nearby` read: wires the `NearbyPoints` use case
 * (`application/nearby-points.ts`) to the Neon adapters
 * (`adapters/outbound/nearby-points.ts`) and a console observer. Radius
 * policy, distance ordering, and typed empty results are the use case's job —
 * this file only adapts dependencies and logs.
 */

import { nearbyDetailsPort, nearbyGeoPort } from "../adapters/outbound/nearby-points";
import {
  nearbyPoints,
  type NearbyObservation,
  type NearbyObserverPort,
} from "../application/nearby-points";
import type { CatalogDb, NeonSql } from "../db/client";
import type { Point } from "../types";

export interface NearbyInput {
  lat: number;
  lng: number;
  radius_m: number;
}

/** Redacted observation line: radius bucket, count, outcome, duration — no coordinates. */
const observer: NearbyObserverPort = {
  record: (observation: NearbyObservation) => {
    console.info(
      `nearby ${observation.outcome} bucket=${observation.radius_bucket} `
      + `count=${String(observation.count)} ${String(observation.duration_ms)}ms`,
    );
  },
};

/** Points within `input.radius_m` meters of (lat,lng), nearest first, with `distance_m`. */
export async function nearby(
  db: CatalogDb,
  neonSql: NeonSql,
  input: NearbyInput,
): Promise<{ rows: Point[] }> {
  return nearbyPoints(nearbyGeoPort(neonSql), nearbyDetailsPort(db), input, { observer });
}
