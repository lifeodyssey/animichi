import { sql } from "drizzle-orm";
import type { CatalogDb, NeonSql } from "../db/client";
import { findPointsWithinRadius, type NearbyPoint } from "../lib/geo-query";
import type { PilgrimagePoint } from "../types";

export interface NearbyInput {
  lat: number;
  lng: number;
  radius_m: number;
}

/** The point columns the geo helper omits, keyed by id for the merge step. */
interface PointDetail {
  id: string;
  bangumi_id: string | null;
  name_cn: string | null;
  image: string | null;
  episode: number | null;
  time_seconds: number | null;
  origin: string | null;
}

function detailOptionals(d: PointDetail): Partial<PilgrimagePoint> {
  return {
    ...(d.name_cn != null && { name_cn: d.name_cn }),
    ...(d.episode != null && { episode: d.episode }),
    ...(d.time_seconds != null && { time_seconds: d.time_seconds }),
    ...(d.origin != null && { origin: d.origin }),
  };
}

function merge(near: NearbyPoint, d?: PointDetail): PilgrimagePoint {
  return {
    id: near.id,
    name: near.name,
    bangumi_id: d?.bangumi_id ?? "",
    screenshot_url: d?.image ?? "",
    latitude: near.latitude,
    longitude: near.longitude,
    distance_m: near.distanceM,
    ...(d ? detailOptionals(d) : {}),
  };
}

/** The point detail columns for `ids`. Raw `sql` (the Drizzle query builder
 * hangs under workerd), matching the IN pattern in api/route.ts. */
async function loadDetails(db: CatalogDb, ids: string[]): Promise<Map<string, PointDetail>> {
  if (ids.length === 0) return new Map();
  const result = await db.execute(sql`
    SELECT id, bangumi_id, name_cn, image, episode, time_seconds, origin
    FROM points
    WHERE id IN (${sql.join(ids, sql`, `)})
  `);
  const rows = result.rows as unknown as PointDetail[];
  return new Map(rows.map((r) => [r.id, r]));
}

/** Points within `input.radius_m` meters of (lat,lng), nearest first, with `distance_m`. */
export async function nearby(
  db: CatalogDb,
  neonSql: NeonSql,
  input: NearbyInput,
): Promise<{ rows: PilgrimagePoint[] }> {
  const near = await findPointsWithinRadius(neonSql, { lat: input.lat, lng: input.lng, radiusM: input.radius_m });
  const details = await loadDetails(db, near.map((p) => p.id));
  return { rows: near.map((p) => merge(p, details.get(p.id))) };
}
