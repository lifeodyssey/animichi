/**
 * Outbound adapter for the nearby-points path (card CATALOG-3): the PostGIS
 * read (`NearbyPointsPort`) and the point-detail enrichment (`PointDetailsPort`).
 * Owns the only geo read in the worker and, as of the #992 one-adapter-seam
 * cutover (story 10), runs through the Drizzle `db` seam like every other
 * adapter — the previous direct Neon tagged-query channel is gone.
 *
 * The PostGIS predicates / ordering are composed from the typed expression
 * helpers (`../db/expressions`) and the Drizzle query builder, so the dialect
 * parameterises and binds them flatly.
 */

import { sql, type SQL } from "drizzle-orm";
import { points as pointsTable } from "../../db/schema";
import * as x from "../../db/expressions";
import type {
  NearbyPoint,
  NearbyPointsPort,
  PointDetail,
  PointDetailsPort,
} from "../../application/nearby-points";
import type { DbExecutor } from "../../db/client";

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

/** Build the `NearbyPointsPort` backed by the Drizzle `db` seam. */
export function nearbyGeoPort(db: DbExecutor): NearbyPointsPort {
  return { pointsWithin: (lat, lng, radiusM) => fetchNearby(db, lat, lng, radiusM) };
}

/** Points within `radiusM` meters of (lat, lng), nearest first (KNN order). */
async function fetchNearby(db: DbExecutor, lat: number, lng: number, radiusM: number): Promise<NearbyPoint[]> {
  const point = x.geoPoint(lat, lng);
  const result = await db.execute(sql`
    SELECT id, name, latitude, longitude,
           ${x.distanceMeters(pointsTable.location, point)} AS distance_m
    FROM points
    WHERE ${x.withinMeters(pointsTable.location, point, radiusM)}
    ORDER BY ${x.knnDistance(pointsTable.location, point)}, id
    LIMIT ${MAX_RESULTS}
  `);
  return (result.rows as unknown as NearbyRow[]).map(toNearbyPoint);
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

/** The point detail columns for `ids`, via the query builder. */
async function loadDetails(db: DbExecutor, ids: string[]): Promise<Map<string, PointDetail>> {
  if (ids.length === 0) return new Map();
  const result = await db.execute(detailsQuery(ids));
  const rows = result.rows as unknown as PointDetail[];
  return new Map(rows.map((row) => [row.id, row]));
}

/** Build the detail IN-select as a typed query-builder statement. */
function detailsQuery(ids: string[]): SQL {
  return sql`
    SELECT id, bangumi_id, name_cn, image, episode, time_seconds, origin, city
    FROM points
    WHERE id IN (${sql.join(ids, sql`, `)})
  `;
}
