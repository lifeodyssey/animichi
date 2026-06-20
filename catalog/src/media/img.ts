/**
 * Lazy-R2 image serving for pilgrimage point photos.
 *
 * First request for a point pulls the origin photo from Anitabi, stores it in R2
 * exactly once, records the asset in `media_assets`, and serves the bytes. Every
 * later request is served straight from R2 (origin never re-fetched). If the
 * origin is gone (404), the asset is tombstoned so we stop re-pulling and serve
 * a fallback. All responses are edge-cacheable (`Cache-Control: public`).
 *
 * media_assets schema (20260620230000_ingest_infrastructure.sql):
 *   point_id PK, r2_key, content_hash, last_origin_pull, tombstoned.
 *
 * `points.image` is already a full URL (parse.ts expands Anitabi's leading-slash
 * paths to image.anitabi.cn at enrich time); we re-expand defensively here too.
 */
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { getImage, putImage } from "./r2";

const IMAGE_BASE = "https://image.anitabi.cn";
const CACHE_CONTROL = "public, max-age=604800, s-maxage=2592000";
const DEFAULT_CONTENT_TYPE = "image/jpeg";

/**
 * Minimal binary-fetch surface for the origin pull (satisfied by the global
 * `fetch`). Unlike `sources.ts`'s JSON `FetchLike`, the media path reads raw
 * bytes + the content-type header, so it needs `arrayBuffer()` and `headers`.
 */
export type ImageFetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** Injected collaborators for `serveImage` (db + R2 binding + fetch). */
export interface ImgDeps {
  db: CatalogDb;
  bucket: R2Bucket;
  fetchImpl: ImageFetchLike;
}

/** A `media_assets` row (only the columns the serving path reads). */
interface MediaAsset {
  r2_key: string | null;
  tombstoned: boolean;
}

/** Serve a point photo: R2 hit, lazy origin pull + store, or tombstone fallback. */
export async function serveImage(deps: ImgDeps, pointId: string): Promise<Response> {
  const asset = await loadAsset(deps.db, pointId);
  if (asset?.tombstoned) return tombstone();
  if (asset?.r2_key) return serveFromR2(deps.bucket, asset.r2_key);
  return lazyPull(deps, pointId);
}

/** Read the existing `media_assets` row for a point, or null on first request. */
async function loadAsset(db: CatalogDb, pointId: string): Promise<MediaAsset | null> {
  const result = await db.execute(
    sql`SELECT r2_key, tombstoned FROM media_assets WHERE point_id = ${pointId}`,
  );
  return (result.rows as unknown as MediaAsset[])[0] ?? null;
}

/** Serve cached bytes from R2; tombstone if the key vanished under us. */
async function serveFromR2(bucket: R2Bucket, key: string): Promise<Response> {
  const object = await getImage(bucket, key);
  if (!object) return tombstone();
  return imageResponse(await object.arrayBuffer(), contentTypeOf(object));
}

/** First request: pull origin, store in R2 + record the asset, then serve. */
async function lazyPull(deps: ImgDeps, pointId: string): Promise<Response> {
  const origin = await originUrl(deps.db, pointId);
  if (!origin) return tombstone();
  const res = await deps.fetchImpl(origin, { headers: { "User-Agent": "Seichijunrei/1.0" } });
  if (res.status === 404 || res.status === 410) return tombstoneAsset(deps.db, pointId);
  if (!res.ok) return new Response("Upstream error", { status: 502 });
  return storeAndServe(deps, pointId, res);
}

/** Store fetched bytes in R2, UPSERT the asset row, and serve the bytes. */
async function storeAndServe(
  deps: ImgDeps,
  pointId: string,
  res: ImageFetchResult,
): Promise<Response> {
  const key = r2KeyFor(pointId);
  const body = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ?? DEFAULT_CONTENT_TYPE;
  await putImage(deps.bucket, key, body, contentType);
  await recordAsset(deps.db, pointId, key, await contentHash(body));
  return imageResponse(body, contentType);
}

/** Look up the point's origin image URL, expanding leading-slash paths. */
async function originUrl(db: CatalogDb, pointId: string): Promise<string | null> {
  const result = await db.execute(sql`SELECT image FROM points WHERE id = ${pointId}`);
  const image = (result.rows as Array<{ image: string | null }>)[0]?.image;
  if (!image) return null;
  return image.startsWith("/") ? `${IMAGE_BASE}${image}` : image;
}

/** UPSERT a stored asset (r2_key + content_hash + last_origin_pull). */
async function recordAsset(
  db: CatalogDb,
  pointId: string,
  key: string,
  hash: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO media_assets (point_id, r2_key, content_hash, last_origin_pull, tombstoned)
    VALUES (${pointId}, ${key}, ${hash}, NOW(), FALSE)
    ON CONFLICT (point_id) DO UPDATE SET
      r2_key = EXCLUDED.r2_key, content_hash = EXCLUDED.content_hash,
      last_origin_pull = NOW(), tombstoned = FALSE
  `);
}

/** Mark a point's asset tombstoned (origin gone) and serve the fallback. */
async function tombstoneAsset(db: CatalogDb, pointId: string): Promise<Response> {
  await db.execute(sql`
    INSERT INTO media_assets (point_id, last_origin_pull, tombstoned)
    VALUES (${pointId}, NOW(), TRUE)
    ON CONFLICT (point_id) DO UPDATE SET last_origin_pull = NOW(), tombstoned = TRUE
  `);
  return tombstone();
}

/** SHA-256 hex digest of the stored bytes (asset content_hash). */
async function contentHash(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The R2 object key for a point's photo. */
function r2KeyFor(pointId: string): string {
  return `points/${pointId}`;
}

/** An edge-cacheable image Response for the given bytes. */
function imageResponse(body: ArrayBuffer, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": contentType, "Cache-Control": CACHE_CONTROL },
  });
}

/** Tombstone fallback: a known 404 so callers can swap a placeholder client-side. */
function tombstone(): Response {
  return new Response("image unavailable", {
    status: 404,
    headers: { "Cache-Control": CACHE_CONTROL },
  });
}

/** The stored content type for an R2 object, defaulting when absent. */
function contentTypeOf(object: R2ObjectBody): string {
  return object.httpMetadata?.contentType ?? DEFAULT_CONTENT_TYPE;
}

/** The resolved value of an `ImageFetchLike` call. */
type ImageFetchResult = Awaited<ReturnType<ImageFetchLike>>;
