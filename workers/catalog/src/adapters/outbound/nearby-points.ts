/**
 * Outbound adapter for the nearby-points path (card CATALOG-3): the PostGIS
 * read (`NearbyPointsPort`) and the point-detail enrichment (`PointDetailsPort`).
 * Owns the only geo SQL in the worker — `ST_DWithin` / `ST_Distance` with KNN
 * ordering — plus the detail IN-read.
 *
 * Values are bound inline, never as a nested Drizzle fragment: a fragment
 * interpolated into the `neon()` template rendered as `?`-riddled text, which
 * the direct-cloud endpoint rejects with "parse error - invalid geometry" (the
 * #883 local proxy masked it locally). Flat binding keeps the same SQL valid
 * over pg in the spike lane.
 */

import { sql } from "drizzle-orm";
import type {
  NearbyPoint,
  NearbyPointsPort,
  PointDetail,
  PointDetailsPort,
} from "../../application/nearby-points";
import type { DbExecutor, NeonSql } from "../../db/client";

/** The geo columns the adapter selects; `distance_m` is meters. */
interface NearbyRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distance_m: number;
}

/** Cap on returned points — the radius bounds the result, never a page count. */
const MAX_RESULTS = 200;

/** Build the `NearbyPointsPort` backed by the Neon template tag. */
export function nearbyGeoPort(neonSql: NeonSql): NearbyPointsPort {
  return { pointsWithin: (lat, lng, radiusM) => fetchNearby(neonSql, lat, lng, radiusM) };
}

/** Points within `radiusM` meters of (lat, lng), nearest first (KNN order). */
async function fetchNearby(neonSql: NeonSql, lat: number, lng: number, radiusM: number): Promise<NearbyPoint[]> {
  const rows = await neonSql`
    SELECT id, name, latitude, longitude,
           ST_Distance(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS distance_m
    FROM points
    WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusM})
    ORDER BY location <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, id
    LIMIT ${MAX_RESULTS}
  `;
  return (rows as unknown as NearbyRow[]).map(toNearbyPoint);
}

/** Map a geo row to the port's `NearbyPoint` shape. */
function toNearbyPoint(row: NearbyRow): NearbyPoint {
  return {
    id: row.id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    distanceM: row.distance_m,
  };
}

/** Build the `PointDetailsPort` backed by a Drizzle executor (db or tx). */
export function nearbyDetailsPort(db: DbExecutor): PointDetailsPort {
  return { detailsFor: (ids) => loadDetails(db, ids) };
}

/** The point detail columns for `ids`. Raw `sql` (the Drizzle query builder
 * hangs under workerd), matching the IN pattern in api/route.ts. */
async function loadDetails(db: DbExecutor, ids: string[]): Promise<Map<string, PointDetail>> {
  if (ids.length === 0) return new Map();
  const result = await db.execute(sql`
    SELECT id, bangumi_id, name_cn, image, episode, time_seconds, origin, city
    FROM points
    WHERE id IN (${sql.join(ids, sql`, `)})
  `);
  const rows = result.rows as unknown as PointDetail[];
  return new Map(rows.map((row) => [row.id, row]));
}
