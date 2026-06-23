import { sql } from "drizzle-orm";
import type { CatalogDb } from "../db/client";

/**
 * Typed PostGIS ST_DWithin radius read for the Catalog `nearby` API.
 *
 * The read primitive behind point-near-location lookups. Expressed with raw
 * `sql` (Drizzle has no native GEOGRAPHY predicate) following the validated
 * spike pattern: filter by `ST_DWithin(location, center, radiusM)` on the
 * GEOGRAPHY column, compute `ST_Distance` as `distance_m`, and order by the
 * `<->` KNN operator so the nearest point comes first.
 *
 * Read-only: no inserts, no reverse-geocode/city-backfill (that is an enrich
 * concern). The caller owns the connection (Hyperdrive in prod, testcontainer
 * locally) via `CatalogDb`.
 */

export interface NearbyQuery {
  lat: number;
  lng: number;
  radiusM: number;
}

export interface NearbyPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceM: number;
}

interface NearbyRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distance_m: number;
}

const center = ({ lat, lng }: NearbyQuery) =>
  sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

const toPoint = (r: NearbyRow): NearbyPoint => ({
  id: r.id,
  name: r.name,
  latitude: Number(r.latitude),
  longitude: Number(r.longitude),
  distanceM: Number(r.distance_m),
});

const MAX_RADIUS_M = 50_000;
const MAX_RESULTS = 200;

/** Points within `radiusM` meters of (lat,lng), nearest first, with `distanceM`. */
export async function findPointsWithinRadius(
  db: CatalogDb,
  q: NearbyQuery,
): Promise<NearbyPoint[]> {
  const clampedRadius = Math.min(q.radiusM, MAX_RADIUS_M);
  const c = center(q);
  const result = await db.execute(sql`
    SELECT id, name, latitude, longitude, ST_Distance(location, ${c}) AS distance_m
    FROM points
    WHERE ST_DWithin(location, ${c}, ${clampedRadius})
    ORDER BY location <-> ${c}
    LIMIT ${MAX_RESULTS}
  `);
  return (result.rows as unknown as NearbyRow[]).map(toPoint);
}
