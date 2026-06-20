import { inArray } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { points } from "../db/schema";
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
  bangumiId: string | null;
  nameCn: string | null;
  image: string | null;
  episode: number | null;
  timeSeconds: number | null;
  origin: string | null;
}

const merge = (near: NearbyPoint, d?: PointDetail): PilgrimagePoint => ({
  id: near.id,
  name: near.name,
  name_cn: d?.nameCn ?? undefined,
  bangumi_id: d?.bangumiId ?? "",
  episode: d?.episode ?? undefined,
  time_seconds: d?.timeSeconds ?? undefined,
  screenshot_url: d?.image ?? "",
  latitude: near.latitude,
  longitude: near.longitude,
  origin: d?.origin ?? undefined,
  distance_m: near.distanceM,
});

const detailColumns = {
  id: points.id,
  bangumiId: points.bangumiId,
  nameCn: points.nameCn,
  image: points.image,
  episode: points.episode,
  timeSeconds: points.timeSeconds,
  origin: points.origin,
};

async function loadDetails(db: CatalogDb, ids: string[]): Promise<Map<string, PointDetail>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select(detailColumns).from(points).where(inArray(points.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Points within `input.radius_m` meters of (lat,lng), nearest first, with `distance_m`. */
export async function nearby(db: CatalogDb, input: NearbyInput): Promise<{ rows: PilgrimagePoint[] }> {
  const near = await findPointsWithinRadius(db, { lat: input.lat, lng: input.lng, radiusM: input.radius_m });
  const details = await loadDetails(db, near.map((p) => p.id));
  return { rows: near.map((p) => merge(p, details.get(p.id))) };
}
