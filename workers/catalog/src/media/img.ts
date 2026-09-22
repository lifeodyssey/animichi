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
 *
 * Every statement is a builder plan on the request's runtime
 * ({@link CatalogPrisma}). The two writes are upserts, which the builder's own
 * surface cannot state, so they are the plan repairs in `../db/plans`: the
 * conflict clause, and `last_origin_pull` assigned the DATABASE's clock rather
 * than a value this Worker binds.
 */
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../db/prisma";
import { atServerNow, upsert } from "../db/plans";
import { getImage, putImage } from "./r2";
import {
  ANITABI_USER_AGENT,
  withAnitabiImagePlan,
  type AnitabiImagePlan,
} from "@animichi/contract/anitabi-display";

const IMAGE_BASE = "https://image.anitabi.cn";
const CACHE_CONTROL = "public, max-age=604800, s-maxage=2592000";
const DEFAULT_CONTENT_TYPE = "image/jpeg";

export type ImageFetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** Injected collaborators for `serveImage` (plan seam + R2 binding + fetch). */
export interface ImgDeps {
  query: CatalogPrisma;
  bucket: R2Bucket;
  fetchImpl: ImageFetchLike;
}

/** A `media_assets` row (only the columns the serving path reads). */
interface MediaAsset extends Record<string, unknown> {
  r2_key: string | null;
  tombstoned: boolean;
}

/** Serve a point photo: R2 hit, lazy origin pull + store, or tombstone fallback. */
export async function serveImage(
  deps: ImgDeps, pointId: string, plan: AnitabiImagePlan,
): Promise<Response> {
  const asset = await loadAsset(deps.query, pointId);
  if (asset?.tombstoned) return tombstone();
  if (asset?.r2_key) return serveFromR2(deps.bucket, asset.r2_key);
  return lazyPull(deps, pointId, plan);
}

/** Read the existing `media_assets` row for a point, or null on first request. */
async function loadAsset(query: CatalogPrisma, pointId: string): Promise<MediaAsset | null> {
  const rows = await query.executor.query(assetPlan(query, pointId));
  return rows[0] ?? null;
}

/** The SELECT of the two columns the serving path branches on. */
function assetPlan(query: CatalogPrisma, pointId: string): SqlOrmPlan<MediaAsset> {
  return query.builder.public.media_assets
    .select("r2_key", "tombstoned")
    .where((fields, match) => match.eq(fields.point_id, pointId))
    .build();
}

/** Serve cached bytes from R2; tombstone if the key vanished under us. */
async function serveFromR2(bucket: R2Bucket, key: string): Promise<Response> {
  const object = await getImage(bucket, key);
  if (!object) return tombstone();
  return imageResponse(await object.arrayBuffer(), contentTypeOf(object));
}

/** First request: pull origin, store in R2 + record the asset, then serve. */
async function lazyPull(
  deps: ImgDeps, pointId: string, plan: AnitabiImagePlan,
): Promise<Response> {
  const origin = await originUrl(deps.query, pointId, plan);
  if (!origin) return tombstone();
  const res = await deps.fetchImpl(origin, { headers: { "User-Agent": ANITABI_USER_AGENT } });
  if (res.status === 404 || res.status === 410) return tombstoneAsset(deps.query, pointId);
  if (!res.ok) return new Response("Upstream error", { status: 502 });
  return storeAndServe(deps, pointId, res);
}

/** Store fetched bytes in R2, UPSERT the asset row, and serve the bytes. */
async function storeAndServe(
  deps: ImgDeps, pointId: string, res: ImageFetchResult,
): Promise<Response> {
  const key = r2KeyFor(pointId);
  const body = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") ?? DEFAULT_CONTENT_TYPE;
  await putImage(deps.bucket, key, body, contentType);
  await recordAsset(deps.query, pointId, key, await contentHash(body));
  return imageResponse(body, contentType);
}

/** Look up the point's origin image URL, expanding leading-slash paths. */
async function originUrl(
  query: CatalogPrisma, pointId: string, plan: AnitabiImagePlan,
): Promise<string | null> {
  const rows = await query.executor.query(pointImagePlan(query, pointId));
  const image = rows[0]?.image;
  if (!image) return null;
  return originPullUrl(image, plan);
}

/** The SELECT of one point's stored origin image URL. */
function pointImagePlan(
  query: CatalogPrisma, pointId: string,
): SqlOrmPlan<{ image: string | null }> {
  return query.builder.public.points
    .select("image")
    .where((fields, match) => match.eq(fields.id, pointId))
    .build();
}

/** The origin URL a public display path may fetch: an explicit size plan is required. */
export function originPullUrl(stored: string, plan: AnitabiImagePlan): string {
  const expanded = stored.startsWith("/") ? `${IMAGE_BASE}${stored}` : stored;
  return withAnitabiImagePlan(expanded, plan);
}

/** UPSERT a stored asset (r2_key + content_hash + last_origin_pull). */
async function recordAsset(
  query: CatalogPrisma, pointId: string, key: string, hash: string,
): Promise<void> {
  await query.executor.query(assetUpsertPlan(query, pointId, key, hash));
}

/** The asset-record UPSERT (over writes, clears the tombstone). */
function assetUpsertPlan(
  query: CatalogPrisma, pointId: string, key: string, hash: string,
): SqlOrmPlan {
  const insert = query.builder.public.media_assets
    .insert([{ point_id: pointId, r2_key: key, content_hash: hash, tombstoned: false }])
    .build();
  return stampedUpsert(insert, ["r2_key", "content_hash", "tombstoned"]);
}

/** Mark a point's asset tombstoned (origin gone) and serve the fallback. */
async function tombstoneAsset(query: CatalogPrisma, pointId: string): Promise<Response> {
  await query.executor.query(tombstonePlan(query, pointId));
  return tombstone();
}

/** The tombstone UPSERT: origin pull timestamp + the tombstone flag. */
function tombstonePlan(query: CatalogPrisma, pointId: string): SqlOrmPlan {
  const insert = query.builder.public.media_assets
    .insert([{ point_id: pointId, tombstoned: true }])
    .build();
  return stampedUpsert(insert, ["tombstoned"]);
}

/**
 * One asset write: stamp `last_origin_pull` with the server clock, then let a
 * clash overwrite `columns` and that stamp from the row just proposed.
 *
 * The stamp is applied to the INSERT's own row, so `EXCLUDED.last_origin_pull`
 * carries it on the conflict arm — which is how the pre-#1633 statement set it,
 * and is the only way to state it: a conflict assignment copies the proposed
 * row, never an expression of its own. The difference that leaves is on the
 * INSERT arm, where the column used to stay NULL and now records the pull that
 * created the row. Both callers reach here having just pulled the origin, so the
 * stamp is true on that arm too, and nothing reads the column back.
 */
function stampedUpsert<Row>(insert: SqlOrmPlan<Row>, columns: readonly string[]): SqlOrmPlan<Row> {
  return upsert(atServerNow(insert, [LAST_PULL]), {
    target: ["point_id"],
    update: [...columns, LAST_PULL],
  });
}

/** The column both writes stamp with the database's own clock. */
const LAST_PULL = "last_origin_pull";

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
