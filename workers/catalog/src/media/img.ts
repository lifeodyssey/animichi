/**
 * Lazy-R2 image serving for pilgrimage point photos.
 *
 * First request for a point pulls the origin photo from Anitabi, stores it in R2
 * exactly once, records the asset in `media_assets`, and serves the bytes. Every
 * later request is served straight from R2 (origin never re-fetched). If the
 * origin is gone (404), the asset is tombstoned so we stop re-pulling and serve
 * a fallback. The photo and the fallback are edge-cacheable (`Cache-Control:
 * public`); the 502 a failed pull answers is not.
 *
 * media_assets schema (20260620230000_ingest_infrastructure.sql):
 *   point_id PK, r2_key, content_hash, last_origin_pull, tombstoned.
 *
 * The URL a pull fetches is `./image-origin.ts`'s to build, from the point's
 * stored `points.image`, and it is always on the image origin. A stored value
 * that names no URL there answers 404 `{"error":"image origin not allowed"}`:
 * nothing is fetched, stored in R2 or recorded in `media_assets`, so a corrected
 * row is pulled on its next request. The pull never follows a redirect: it asks
 * for `redirect: "manual"`, so a 3xx comes back as the answer and is a bad
 * origin status like any other non-2xx.
 *
 * The origin pull runs under the request's signal and a timeout, whichever ends
 * first, so a hung origin or a departed client stops it, body read included. A
 * pull that times out or fails in transport answers 502 "Upstream error", as a
 * bad origin status does; a pull the client cancelled rethrows the client's own
 * reason. Neither stores nor tombstones anything.
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
import { DEFAULT_ATTEMPT_TIMEOUT_MS } from "../ingest/retry";
import { getImage, putImage } from "./r2";
import { originPullUrl } from "./image-origin";
import { ANITABI_USER_AGENT, type AnitabiImagePlan } from "@animichi/contract/anitabi-display";

const CACHE_CONTROL = "public, max-age=604800, s-maxage=2592000";
const DEFAULT_CONTENT_TYPE = "image/jpeg";

export type ImageFetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal; redirect?: "manual" },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** Injected collaborators for `serveImage` (plan seam + R2 binding + fetch), and the request's signal. */
export interface ImgDeps {
  query: CatalogPrisma;
  bucket: R2Bucket;
  fetchImpl: ImageFetchLike;
  /** The request's own signal: a client that leaves aborts the origin pull in flight. */
  signal?: AbortSignal;
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
  const stored = await storedImage(deps.query, pointId);
  if (!stored) return tombstone();
  const origin = originPullUrl(stored, plan);
  if (origin === null) return originNotAllowed(pointId);
  const pulled = await pullOrigin(deps, origin);
  if (pulled === "gone") return tombstoneAsset(deps.query, pointId);
  if (pulled === "failed") return new Response("Upstream error", { status: 502 });
  return storeAndServe(deps, pointId, pulled);
}

/** The photo an origin pull brought back: its bytes, read whole, and their content type. */
interface OriginPhoto {
  body: ArrayBuffer;
  contentType: string;
}

/**
 * One origin pull: the photo, `gone` when the origin no longer has it
 * (404/410), or `failed` for a bad status, a timeout or a transport failure,
 * whether the headers or the body ran into it. A pull the caller cancelled
 * rethrows the caller's own reason, whatever error the abort surfaced as: the
 * client left, the origin did not fail.
 */
async function pullOrigin(deps: ImgDeps, origin: string): Promise<OriginPhoto | "gone" | "failed"> {
  try {
    return await fetchPhoto(deps, origin);
  } catch {
    deps.signal?.throwIfAborted();
    return "failed";
  }
}

/** The origin request and its body read, both under the pull's signal; a redirect is answered, never followed. */
async function fetchPhoto(deps: ImgDeps, origin: string): Promise<OriginPhoto | "gone" | "failed"> {
  const res = await deps.fetchImpl(origin, { headers: { "User-Agent": ANITABI_USER_AGENT }, signal: pullSignal(deps.signal), redirect: "manual" });
  if (res.status === 404 || res.status === 410) return "gone";
  if (!res.ok) return "failed";
  return { body: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? DEFAULT_CONTENT_TYPE };
}

/**
 * One origin pull's signal: the request's cancel or the pull timeout, whichever
 * comes first. No caller reaches `/catalog/img` today (the edge serves `/img/*`
 * itself), so there is no caller's wait to derive the bound from: a pull gets
 * what one catalog upstream attempt gets, and a hung origin stops holding one
 * of the invocation's six connections that wait for response headers.
 */
function pullSignal(caller: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(DEFAULT_ATTEMPT_TIMEOUT_MS);
  return AbortSignal.any(caller === undefined ? [timeout] : [caller, timeout]);
}

/** Store the pulled bytes in R2, UPSERT the asset row, and serve the bytes. */
async function storeAndServe(
  deps: ImgDeps, pointId: string, photo: OriginPhoto,
): Promise<Response> {
  const key = r2KeyFor(pointId);
  await putImage(deps.bucket, key, photo.body, photo.contentType);
  await recordAsset(deps.query, pointId, key, await contentHash(photo.body));
  return imageResponse(photo.body, photo.contentType);
}

/** The point's stored origin image, or null when it has none. */
async function storedImage(query: CatalogPrisma, pointId: string): Promise<string | null> {
  const rows = await query.executor.query(pointImagePlan(query, pointId));
  return rows[0]?.image ?? null;
}

/** A stored image that names no URL on the image origin: refused, with nothing fetched, stored or recorded. */
function originNotAllowed(pointId: string): Response {
  console.warn(`[media] image origin not allowed for point ${pointId}`);
  return Response.json({ error: "image origin not allowed" }, { status: 404 });
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
