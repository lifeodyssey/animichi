/**
 * A `points` row's wire form: the one mapping from a row, as a read selects it,
 * to the contract `Point` (`../types`, the in-Worker mirror of
 * packages/contract/src/models.ts).
 *
 * Points-by-bangumi-id (`list-points-for-bangumi.ts`), itinerary
 * (`../adapters/outbound/route-points.ts`) and nearby (`nearby-points.ts`) all
 * map their rows here, so every endpoint answers
 * the same row the same way. The required fields are always present, and a null
 * bangumi_id or image becomes "" because the contract requires a string. Every
 * other field is present exactly when its column holds a value: null is left out
 * (`./optional.ts`), and any other value, "" included, is kept. The work's
 * title, title_cn and cover_url arrive only from the reads that join `bangumi`.
 */

import { optional } from "./optional";
import type { Point } from "../types";

/** The columns a read selects for one point; only the joined reads carry the work's titles. */
interface PointRow {
  id: string;
  name: string;
  name_cn: string | null;
  bangumi_id: string | null;
  episode: number | null;
  time_seconds: number | null;
  image: string | null;
  latitude: number;
  longitude: number;
  city?: string | null;
  origin: string | null;
  origin_url: string | null;
  title?: string | null;
  title_cn?: string | null;
  cover_url?: string | null;
}

/** A point row as the contract `Point`. */
export function toPoint(row: PointRow): Point {
  return { ...requiredFields(row), ...optionalFields(row) };
}

/** The fields the contract requires, whatever the row holds. */
function requiredFields(row: PointRow): Point {
  return {
    id: row.id,
    name: row.name,
    bangumi_id: row.bangumi_id ?? "",
    screenshot_url: row.image ?? "",
    latitude: row.latitude,
    longitude: row.longitude,
  };
}

/** The optional fields, each only when its column is not null. */
function optionalFields(row: PointRow): Partial<Point> {
  return optional({
    name_cn: row.name_cn, episode: row.episode, time_seconds: row.time_seconds,
    title: row.title, title_cn: row.title_cn, cover_url: row.cover_url,
    city: row.city, origin: row.origin, origin_url: row.origin_url,
  });
}
