/**
 * Raw-zone JSON -> typed catalog rows.
 *
 * Close port of the Python parsers' field mapping
 * (`backend/clients/anitabi.py`, `backend/clients/bangumi.py`): same legacy vs
 * official Anitabi point schemas and the same Bangumi v0 subject shape, mapped
 * onto the catalog table columns
 * (`supabase/migrations/20260402120000_remote_schema.sql`: `bangumi`, `points`).
 *
 * This is the JSON trust boundary: every field is narrowed defensively from
 * `unknown` (object + isinstance-style guards, no `any`). A point lacking an id,
 * name, or coordinates is skipped. Two deliberate differences from Python:
 * (a) name_cn is NOT back-filled from name (left null); (b) a legacy point missing
 * its screenshot is KEPT (image=null) rather than dropped.
 */

const IMAGE_BASE = "https://image.anitabi.cn";

/** A `bangumi` row ready for UPSERT. Column names match the SQL table. */
export interface BangumiRow {
  id: string;
  title: string;
  title_cn: string | null;
  cover_url: string | null;
  summary: string | null;
  rating: number | null;
  eps_count: number | null;
  air_date: string | null;
}

/** A `points` row ready for UPSERT. The trigger derives `location` from lat/lng. */
export interface PointRow {
  id: string;
  bangumi_id: string;
  name: string;
  name_cn: string | null;
  latitude: number;
  longitude: number;
  image: string | null;
  episode: number | null;
  time_seconds: number;
  origin: string | null;
  origin_url: string | null;
}

/** Type guard: a non-null, non-array object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Coerce an unknown JSON value to a trimmed string, or null when absent. */
function asStr(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

/** Coerce an unknown JSON value to a finite number, or null. */
function asNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Pick the first non-null string from a list of candidate keys. */
function pickStr(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = asStr(obj[key]);
    if (v !== null) return v;
  }
  return null;
}

/** Resolve the Bangumi cover URL from the v0 `images` object (any size). */
function coverFromImages(images: unknown): string | null {
  if (!isObject(images)) return asStr(images);
  return pickStr(images, ["large", "common", "medium", "small", "grid"]);
}

/** Parse a raw Bangumi v0 subject payload into a `bangumi` row. */
export function parseBangumi(workId: string, payload: unknown): BangumiRow {
  if (!isObject(payload)) throw new Error("Bangumi payload is not an object");
  const title = pickStr(payload, ["name", "name_cn"]);
  if (!title) throw new Error("Bangumi payload has no title");
  return buildBangumiRow(workId, payload, title);
}

/** Assemble the `bangumi` row from a narrowed subject object. */
function buildBangumiRow(
  workId: string,
  subject: Record<string, unknown>,
  title: string,
): BangumiRow {
  return {
    id: workId,
    title,
    title_cn: asStr(subject["name_cn"]),
    cover_url: coverFromImages(subject["images"]),
    summary: asStr(subject["summary"]),
    rating: ratingScore(subject["rating"]),
    eps_count: asNum(subject["total_episodes"]) ?? asNum(subject["eps"]),
    air_date: pickStr(subject, ["date", "air_date"]),
  };
}

/** Extract the numeric score from Bangumi's `rating: {score}` object. */
function ratingScore(rating: unknown): number | null {
  if (isObject(rating)) return asNum(rating["score"]);
  return asNum(rating);
}

/** Parse a raw Anitabi points payload into `points` rows, skipping bad items. */
export function parseAnitabiPoints(workId: string, payload: unknown): PointRow[] {
  const items = pointItems(payload);
  const rows: PointRow[] = [];
  for (const item of items) {
    const row = tryParsePoint(workId, item);
    if (row) rows.push(row);
  }
  return rows;
}

/** Narrow the Anitabi payload to its point-object list (legacy or official). */
function pointItems(payload: unknown): Record<string, unknown>[] {
  const list = Array.isArray(payload) ? payload : nestedList(payload);
  return list.filter(isObject);
}

/** Pull `data`/`points` out of an object-wrapped Anitabi payload. */
function nestedList(payload: unknown): unknown[] {
  if (!isObject(payload)) return [];
  const list = payload["data"] ?? payload["points"];
  return Array.isArray(list) ? list : [];
}

/** Parse one point item, returning null if it lacks id/name/coords. */
function tryParsePoint(workId: string, item: Record<string, unknown>): PointRow | null {
  const id = asStr(item["id"]);
  const coords = pointCoords(item);
  const name = pickStr(item, ["name", "cn", "cn_name"]);
  if (!id || !coords || !name) return null;
  return buildPointRow(workId, item, { id, name, ...coords });
}

/** Resolve [lat, lng] from the legacy lat/lng pair or the official geo array. */
function pointCoords(item: Record<string, unknown>): { latitude: number; longitude: number } | null {
  const geo = item["geo"];
  if (Array.isArray(geo) && geo.length >= 2) {
    return numericCoords(asNum(geo[0]), asNum(geo[1]));
  }
  return numericCoords(asNum(item["lat"]), asNum(item["lng"]));
}

/** Combine a lat/lng pair into a coords object, or null if either is absent. */
function numericCoords(
  lat: number | null,
  lng: number | null,
): { latitude: number; longitude: number } | null {
  if (lat === null || lng === null) return null;
  return { latitude: lat, longitude: lng };
}

/** Assemble the `points` row from a narrowed point object. */
function buildPointRow(
  workId: string,
  item: Record<string, unknown>,
  core: { id: string; name: string; latitude: number; longitude: number },
): PointRow {
  return {
    ...core,
    bangumi_id: workId,
    name_cn: pickStr(item, ["cn", "cn_name"]),
    image: pointImage(item),
    episode: asNum(item["episode"]) ?? asNum(item["ep"]),
    time_seconds: asNum(item["time_seconds"]) ?? asNum(item["s"]) ?? 0,
    origin: asStr(item["origin"]),
    origin_url: pickStr(item, ["origin_url", "originURL"]),
  };
}

/** Resolve the point image URL, expanding Anitabi's leading-slash paths. */
function pointImage(item: Record<string, unknown>): string | null {
  const url = pickStr(item, ["image", "screenshot"]);
  if (url && url.startsWith("/")) return `${IMAGE_BASE}${url}`;
  return url;
}
