/**
 * Catalog `spots` read handler — one representative pilgrimage point for a work,
 * optionally annotated with `distance_m` from a caller-supplied origin.
 *
 * Shape source of truth: packages/contract/src/contract.ts ->
 *   spots(bangumi_id, origin?) -> { point: PilgrimagePoint, distance_m? }
 * The contract returns a SINGLE point (not a list), so we pick the work's
 * representative point (lowest id, deterministic) and 404 if the work has none.
 *
 * Read-only: a single typed `db.execute(sql`...`)` following the validated
 * geo-query.ts pattern (Drizzle has no native GEOGRAPHY predicate). The wire
 * shapes (`PilgrimagePoint` / `Origin`) come from `../types` — the single
 * in-Worker mirror of packages/contract/src/models.ts (import type erases at
 * compile time, keeping the contract's zod runtime out of the bundle).
 */

import type { CatalogDb } from "../db/client";
import { sql } from "drizzle-orm";
import { haversine } from "../lib/geo";
import { optional } from "../lib/optional";
import type { Origin, PilgrimagePoint } from "../types";

export type { Origin, PilgrimagePoint };

/** Raw column shape returned by the points read query. */
interface PointRow {
  id: string;
  name: string;
  name_cn: string | null;
  bangumi_id: string;
  episode: number | null;
  time_seconds: number | null;
  image: string | null;
  latitude: number;
  longitude: number;
  city?: string | null;
}

/** Thrown when the work has no pilgrimage points to represent it. */
export class SpotNotFoundError extends Error {
  constructor(public readonly bangumiId: string) {
    super(`no pilgrimage points for bangumi_id=${bangumiId}`);
    this.name = "SpotNotFoundError";
  }
}

/** Representative point for a work (lowest id first for a stable pick). */
function representativeQuery(bangumiId: string) {
  return sql`
    SELECT id, name, name_cn, bangumi_id, episode, time_seconds,
           image, latitude, longitude, city
    FROM points
    WHERE bangumi_id = ${bangumiId}
    ORDER BY id ASC
    LIMIT 1
  `;
}

/** Map a DB row to the contract PilgrimagePoint shape (omitting null columns). */
function toPoint(r: PointRow): PilgrimagePoint {
  return {
    id: r.id,
    name: r.name,
    bangumi_id: r.bangumi_id,
    screenshot_url: r.image ?? "",
    latitude: r.latitude,
    longitude: r.longitude,
    ...(r.name_cn ? { name_cn: r.name_cn } : {}),
    ...optional({ episode: r.episode, time_seconds: r.time_seconds }),
    ...(r.city ? { city: r.city } : {}),
  };
}

/** Distance in meters from a lat/lng origin to the point; undefined for named origins. */
function distanceFrom(point: PilgrimagePoint, origin?: Origin): number | undefined {
  if (!origin || typeof origin === "string") {
    return undefined;
  }
  return haversine(origin.lat, origin.lng, point.latitude, point.longitude);
}

/** Fetch the representative point for a work, with optional distance from origin. */
export async function spots(
  db: CatalogDb,
  input: { bangumi_id: string; origin?: Origin },
): Promise<{ point: PilgrimagePoint; distance_m?: number }> {
  const result = await db.execute(representativeQuery(input.bangumi_id));
  const row = (result.rows as unknown as PointRow[])[0];
  if (!row) {
    throw new SpotNotFoundError(input.bangumi_id);
  }
  const point = toPoint(row);
  const distance_m = distanceFrom(point, input.origin);
  return distance_m == null ? { point } : { point, distance_m };
}
