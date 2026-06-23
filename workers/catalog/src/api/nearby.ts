import { sql } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { findPointsWithinRadius, type NearbyPoint } from "../lib/geo-query";
import type { PilgrimagePoint } from "../types";

/**
 * Catalog `nearby` read API — points within a radius of a coordinate.
 *
 * Reuses the committed, PostGIS-integration-tested `findPointsWithinRadius`
 * (card W1-3) for the radius filter + nearest-first ordering + `distance_m`.
 * That helper selects only a minimal shape (id/name/lat/lng/distanceM), so the
 * remaining contract-required fields (`bangumi_id`, `screenshot_url`, …) are
 * fetched in one follow-up read keyed by the matched ids; the geo helper's
 * nearest-first order and distance are preserved.
 *
 * Output mirrors `PilgrimagePoint`, imported (type-only) from `../types` — the
 * single in-Worker mirror of packages/contract/src/models.ts (the Worker bundle
 * deliberately does not import the contract's zod runtime). MUST stay in lockstep.
 *
 * Fields the geo helper does NOT return and that the points table also lacks
 * (`title`, `title_cn`, `cover_url` — they live on `bangumi`) are left unset;
 * they are optional in the contract and out of scope for a single-table read.
 */

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

const merge = (near: NearbyPoint, d?: PointDetail): PilgrimagePoint => ({
  id: near.id,
  name: near.name,
  name_cn: d?.name_cn ?? undefined,
  bangumi_id: d?.bangumi_id ?? "",
  episode: d?.episode ?? undefined,
  time_seconds: d?.time_seconds ?? undefined,
  screenshot_url: d?.image ?? "",
  latitude: near.latitude,
  longitude: near.longitude,
  origin: d?.origin ?? undefined,
  distance_m: near.distanceM,
});

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
export async function nearby(db: CatalogDb, input: NearbyInput): Promise<{ rows: PilgrimagePoint[] }> {
  const near = await findPointsWithinRadius(db, { lat: input.lat, lng: input.lng, radiusM: input.radius_m });
  const details = await loadDetails(db, near.map((p) => p.id));
  return { rows: near.map((p) => merge(p, details.get(p.id))) };
}
