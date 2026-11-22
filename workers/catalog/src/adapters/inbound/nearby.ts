/**
 * Inbound transport for the `nearby` read: wires the `NearbyPoints` use case
 * (`application/nearby-points.ts`) to the Neon adapters
 * (`adapters/outbound/nearby-points.ts`) and a console observer. Radius
 * policy, distance ordering, and typed empty results are the use case's job —
 * this file only adapts dependencies and logs.
 */

import { nearbyDetailsPort, nearbyGeoPort } from "../outbound/nearby-points";
import {
  nearbyPoints,
  type NearbyObservation,
  type NearbyObserverPort,
} from "../../application/nearby-points";
import type { CatalogPrisma } from "../../db/prisma";
import type { Point } from "../../types";

export interface NearbyInput {
  lat: number;
  lng: number;
  radius_m: number;
}

/** Redacted observation line: radius bucket, count, outcome, duration and the
 * gateway's request ID (`-` when none came) — no coordinates. */
function nearbyObserver(requestId: string | undefined): NearbyObserverPort {
  return {
    record: (observation: NearbyObservation) => {
      console.info(
        `nearby ${observation.outcome} bucket=${observation.radius_bucket} `
        + `count=${String(observation.count)} ${String(observation.duration_ms)}ms request_id=${requestId ?? "-"}`,
      );
    },
  };
}

/** Points within `input.radius_m` meters of (lat,lng), nearest first, with `distance_m`. */
export async function nearby(
  prisma: CatalogPrisma,
  input: NearbyInput,
  requestId?: string,
): Promise<{ rows: Point[] }> {
  return nearbyPoints(nearbyGeoPort(prisma), nearbyDetailsPort(prisma), input, { observer: nearbyObserver(requestId) });
}
