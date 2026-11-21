/// <reference types="@cloudflare/workers-types" />

/**
 * The private-R2 object shell both asset arms answer through (#1650).
 *
 * `proxy/tiles.ts` and `proxy/docs-assets.ts` are one proxy with two key
 * grammars: the same CORS surface, the same `Range` gate, the same edge cache in
 * front of a binding, the same 200/206 projection of what `get` returned, and
 * the same EG-05 refusals. They used to be two copies, and the second copy is
 * how an arm silently stops honouring a gate the other still enforces — the
 * docs arm shipped without the tile arm's `Access-Control-Allow-Methods`, its
 * `Vary: Origin` or its `status === 200` cache gate. So each arm owns only what
 * is genuinely its own: the key grammar, the EG-05 codes its refusals carry,
 * the cache lifetime it publishes, the event a failed cache write is recorded
 * under, and the answer a missing object gets (a vector tile's absence is an
 * empty tile, not a 404). Everything else lives here.
 *
 * The port is deliberately narrow (`get` with an optional range), which is what
 * makes the R2 test seam light: the deployed binding and Miniflare's R2
 * implementation both satisfy it.
 */

import { gatewayRejection } from "../gateway/responses.ts";
import { cacheWrite, type CacheWriteContext } from "./cache-write.ts";
import { parseByteRange, type ByteRange, type RangeDecision } from "./byte-range.ts";

/** One private R2 object, narrowed to what an asset arm reads. */
export type R2Object = Readonly<{
  body: ReadableStream<Uint8Array> | null;
  etag: string;
  httpEtag?: string;
  size: number;
  range?: Readonly<{ offset: number; length: number }>;
  httpMetadata?: Readonly<{ contentType?: string; contentEncoding?: string }>;
}>;

/** Everything R2's `get` offers a private asset arm. */
export interface R2ObjectBucket {
  get(key: string, options?: Readonly<{ range?: ByteRange }>): Promise<R2Object | null>;
}

/** The asset an arm resolved: the key it is stored under, and the content type
 * to answer with when the object carries none of its own. */
export type R2Asset = Readonly<{ key: string; contentType: string }>;

/** What an arm has to say for itself on every answer. The codes are EG-05
 * names, never messages. */
export type PrivateR2ArmPolicy = Readonly<{
  methodCode: string;
  rangeCode: string;
  storageCode: string;
  cacheControl: string;
  cacheWriteEvent: string;
}>;

/** …plus the one answer that depends on what the arm stores. */
export type PrivateR2Arm<Asset extends R2Asset> = PrivateR2ArmPolicy & Readonly<{
  missing: (asset: Asset, request: Request) => Response;
}>;

/** One read in flight: every gate below reads the same six things. */
type R2AssetRead<Asset extends R2Asset = R2Asset> = Readonly<{
  asset: Asset;
  request: Request;
  bucket: R2ObjectBucket;
  decision: RangeDecision;
  ctx: CacheWriteContext;
  policy: PrivateR2ArmPolicy;
}>;

const EXPOSED_HEADERS = "Accept-Ranges, Content-Length, Content-Range, ETag";

/** The CORS surface every private asset answer carries: the preflight allowance
 * `Range` needs (it is not a CORS-safelisted request header), the methods both
 * arms answer, and the origin the tile arm has always allowed. */
const CORS_BASE: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  Vary: "Origin",
};

/** The CORS surface of a private asset read. The range headers are only
 * advertised to a caller that named an origin. */
const corsHeaders = (request: Request): Headers => {
  const headers = new Headers(CORS_BASE);
  if (request.headers.has("Origin")) headers.set("Access-Control-Expose-Headers", EXPOSED_HEADERS);
  return headers;
};

/** The arm's cache policy on a Headers set — what `missing` answers with when
 * the arm's absence is not a refusal (a vector tile that is not there). */
export const responseHeaders = (request: Request, cacheControl: string): Headers => {
  const headers = corsHeaders(request);
  headers.set("Cache-Control", cacheControl);
  return headers;
};

/** A refusal on this surface: the arm's CORS headers, `no-store`, and the
 * shared envelope. */
export const errorResponse = (status: number, code: string, request: Request): Response => {
  const rejection = gatewayRejection(code, status);
  for (const [name, value] of corsHeaders(request)) rejection.headers.set(name, value);
  rejection.headers.set("Cache-Control", "no-store");
  return rejection;
};

/** The method gate every arm answers first: OPTIONS is the preflight, GET and
 * HEAD read the object, and anything else is the arm's own 405. */
export const methodResponse = (request: Request, policy: PrivateR2ArmPolicy): Response | null => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(request, policy.cacheControl) });
  if (request.method === "GET" || request.method === "HEAD") return null;
  return errorResponse(405, policy.methodCode, request);
};

const setRangeHeaders = (headers: Headers, object: R2Object, decision: RangeDecision): void => {
  if (decision.kind !== "slice" || !object.range) return;
  const start = String(object.range.offset);
  const end = String(object.range.offset + object.range.length - 1);
  headers.set("Content-Range", `bytes ${start}-${end}/${String(object.size)}`);
};

const setBodyHeaders = (headers: Headers, object: R2Object): void => {
  if (object.body) headers.set("Content-Length", String(object.range?.length ?? object.size));
};

/** What the stored object says about itself: its own content type beats the
 * extension's default, and its content encoding travels with the bytes. */
const setEntityHeaders = (headers: Headers, asset: R2Asset, object: R2Object): void => {
  headers.set("Content-Type", object.httpMetadata?.contentType ?? asset.contentType);
  headers.set("ETag", object.httpEtag ?? object.etag);
  if (object.httpMetadata?.contentEncoding) headers.set("Content-Encoding", object.httpMetadata.contentEncoding);
};

const objectHeaders = (read: R2AssetRead, object: R2Object): Headers => {
  const headers = responseHeaders(read.request, read.policy.cacheControl);
  headers.set("Accept-Ranges", "bytes");
  setEntityHeaders(headers, read.asset, object);
  setRangeHeaders(headers, object, read.decision);
  setBodyHeaders(headers, object);
  return headers;
};

/** A ranged answer is deliberately `no-store`: the entry a whole read caches is
 * the whole object, and a shared cache storing the slice would answer the next
 * whole request with it. */
const objectResponse = (read: R2AssetRead, object: R2Object): Response => {
  const status = read.decision.kind === "slice" && object.range ? 206 : 200;
  const headers = objectHeaders(read, object);
  if (status === 206) headers.set("Cache-Control", "no-store");
  const body = read.request.method === "HEAD" ? null : object.body;
  return new Response(body, { status, headers });
};

const edgeCache = (): Cache | null => (typeof caches === "undefined" ? null : caches.default);

/** The cache key of a read: same origin and path, method GET — a HEAD answer is
 * the GET answer without its body, so it reads and writes the same entry. */
const cacheKey = (request: Request): Request => {
  const url = new URL(request.url);
  return new Request(url.origin + url.pathname, { method: "GET" });
};

/** A ranged answer is never read from or written to the cache: the entry a
 * whole read stores is the whole object, which is not what a slice asked for. */
const cachedResponse = async (read: R2AssetRead): Promise<Response | null> => {
  const storage = read.decision.kind === "whole" ? edgeCache() : null;
  const hit = storage === null ? null : await storage.match(cacheKey(read.request));
  if (!hit) return null;
  return new Response(read.request.method === "HEAD" ? null : hit.body, { status: hit.status, headers: hit.headers });
};

const cachePut = (read: R2AssetRead, response: Response): void => {
  const storage = edgeCache();
  if (storage) cacheWrite(read.ctx, storage.put(cacheKey(read.request), response.clone()), read.policy.cacheWriteEvent);
};

/** What one read asks the bucket for: a sliced read passes the range it decided
 * on, a whole read asks for the object itself. */
const rangeOptions = (read: R2AssetRead): Readonly<{ range: ByteRange }> | undefined =>
  read.decision.kind === "slice" ? { range: read.decision.range } : undefined;

/** Whether this answer may be stored: the object was asked for whole by a GET,
 * so the entry it leaves behind is the object itself. A slice's entry would
 * answer a later whole read with the slice, and every non-200 answer returns
 * before the write (an absent object through `missing`, a 416 before the read,
 * a failing read through the guard). */
const storableAnswer = (read: R2AssetRead): boolean =>
  read.request.method === "GET" && read.decision.kind === "whole";

const storedResponse = async <Asset extends R2Asset>(
  read: R2AssetRead<Asset>, missing: PrivateR2Arm<Asset>["missing"],
): Promise<Response> => {
  const object = await read.bucket.get(read.asset.key, rangeOptions(read));
  if (!object) return missing(read.asset, read.request);
  const response = objectResponse(read, object);
  if (storableAnswer(read)) cachePut(read, response);
  return response;
};

/** A read that throws is the arm's retryable storage refusal (EG-05), never a
 * fall-through to another origin. */
const guardedStoredResponse = async <Asset extends R2Asset>(
  read: R2AssetRead<Asset>, missing: PrivateR2Arm<Asset>["missing"],
): Promise<Response> => {
  try {
    return await storedResponse(read, missing);
  } catch {
    return errorResponse(503, read.policy.storageCode, read.request);
  }
};

/** The answer for one read that passed admission: the edge cache first — a warm
 * entry answers without touching the binding — then the object itself, with a
 * read that throws answered by the arm's retryable storage refusal (EG-05). */
const cachedOrStoredResponse = async <Asset extends R2Asset>(
  read: R2AssetRead<Asset>, missing: PrivateR2Arm<Asset>["missing"],
): Promise<Response> => {
  const cached = await cachedResponse(read);
  return cached ?? guardedStoredResponse(read, missing);
};

/** The answer for one approved asset: the admission both refusal gates grant
 * (a `Range` naming a slice, a binding that is there), then the cached or
 * stored object. An absent binding is refused BEFORE the cache is consulted, so
 * a detached binding cannot keep serving the entries it left warm. */
export async function privateR2AssetResponse<Asset extends R2Asset>(
  asset: Asset, request: Request, bucket: R2ObjectBucket | undefined, ctx: CacheWriteContext, arm: PrivateR2Arm<Asset>,
): Promise<Response> {
  const decision = parseByteRange(request.headers.get("Range"));
  if (decision.kind === "unsatisfiable") return errorResponse(416, arm.rangeCode, request);
  if (!bucket) return errorResponse(503, arm.storageCode, request);
  const read: R2AssetRead<Asset> = { asset, request, bucket, decision, ctx, policy: arm };
  return cachedOrStoredResponse(read, arm.missing);
}
