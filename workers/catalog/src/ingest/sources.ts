/**
 * Upstream source fetchers for the ingest pipeline.
 *
 * Ported from the Python clients (`backend/clients/anitabi.py`,
 * `backend/clients/bangumi.py`): same endpoints/params, Workers-native fetch.
 * Retry (bounded backoff, `Retry-After` honored) lives in `./retry`.
 *
 *   Anitabi GET {egress}/anitabi/points/{id} — the egress service (#1792)
 *     calls api.anitabi.cn/bangumi/{id}/points/detail?haveImage=true; the
 *     only path to anitabi, signed and ceiling-guarded. Direct upstream
 *     access no longer exists.
 *   Bangumi GET {base}/v0/subjects/{id} (base api.bgm.tv, fetched directly)
 *
 * Nothing here takes a URL: a fetch is an {@link UpstreamRequest} — an
 * enumerated operation plus a validated bangumi id — and `./upstream-requests`
 * builds the URL from it. The egress endpoint and `fetch` are injectable for
 * tests; without the signing key the anitabi fetchers refuse (fail closed).
 * Return shapes are verbatim upstream JSON, destined straight for the raw
 * zone — parsing is downstream.
 */

import {
  isRetryableStatus,
  parseRetryAfter,
  RetryableError,
  withRetry,
  type RetryOptions,
} from "./retry";
import { statusFailure, UpstreamFetchError, UpstreamNotFoundError } from "./upstream-failures";
import { requireEgressSigningKey, signedEgressFetch, type AnitabiOperation } from "./anitabi-egress";
import { EgressRefusedError } from "./egress-refusal";
import {
  BANGUMI_BASE,
  upstreamNameOf,
  upstreamUrlFor,
  type UpstreamRequest,
} from "./upstream-requests";
import { ANITABI_USER_AGENT } from "@animichi/contract/anitabi-display";

export { UpstreamFetchError, UpstreamNotFoundError, UpstreamRefusedError, type UpstreamName } from "./upstream-failures";

/** Minimal fetch surface we depend on; satisfied by the global `fetch`. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; json: () => Promise<unknown> }>;

/** Injectable knobs for the source fetchers (defaulted for prod). */
export interface SourceConfig {
  fetchImpl?: FetchLike;
  /** The anitabi egress signing key (#1792) — REQUIRED for the anitabi
   *  fetchers, which refuse without it (fail closed). Bangumi does not use it. */
  egressSigningKey?: string;
  bangumiBaseUrl?: string;
  /** Retry knobs (bounded backoff, `Retry-After` cap); defaulted for prod. */
  retry?: RetryOptions;
  /** Injectable clock for the request signature; defaulted to `Date.now`. */
  nowMs?: () => number;
}

/** Search-specific Bangumi knobs; `limit` is sent as a query parameter. */
export interface BangumiSearchConfig extends SourceConfig {
  limit?: number;
}

/** A single raw Anitabi point (legacy or official schema; kept verbatim). */
export type AnitabiPoint = Record<string, unknown>;

/** A raw Bangumi subject payload (kept verbatim for the raw zone). */
export type BangumiSubject = Record<string, unknown>;

/** A search result subject with its stable id normalized to a string. */
export type BangumiSearchSubject = BangumiSubject & { id: string };

/**
 * The fast L1 preview from Anitabi's `/lite` endpoint: the FIRST ~10 points
 * (`litePoints`, official geo[] schema) plus `total` (the work's full point
 * count, from `pointsLength`). One small fetch — the basis of the search miss
 * path's immediate preview before the full ingest backgrounds.
 */
export interface AnitabiLite {
  points: AnitabiPoint[];
  total: number;
}

export const BANGUMI_FETCH_N = 8;

/** Fetch the raw pilgrimage point list for a bangumi id, through the egress service. */
export async function fetchAnitabiPoints(
  bangumiId: string,
  cfg: SourceConfig = {},
): Promise<AnitabiPoint[]> {
  const body = await fetchAnitabi("points", bangumiId, cfg);
  return normalizePoints(body);
}

/**
 * Fetch the FAST L1 preview for a bangumi id from Anitabi's `/lite` endpoint.
 *
 * `/{id}/lite` returns metadata plus `litePoints` (the first ~10 points, the
 * official geo[] schema: `id`, `name`, `image`, `ep`, `s`, `geo`) and
 * `pointsLength` (the total point count). This is a single small response —
 * cheap enough to return inline as a preview while the full
 * `/points/detail` ingest runs in the background. Defensive: a missing/garbage
 * body yields an empty preview rather than throwing.
 */
export async function fetchAnitabiLite(
  bangumiId: string,
  cfg: SourceConfig = {},
): Promise<AnitabiLite> {
  const body = await fetchAnitabi("lite", bangumiId, cfg);
  return parseLite(body);
}

/**
 * One anitabi fetch through the egress service (#1792): the request is the
 * service's named operation plus a validated id, the fetch signs it and
 * polices the markers, and the ordinary retry/status machinery runs on top.
 * The upstream URL itself is built inside the service.
 */
async function fetchAnitabi(
  operation: AnitabiOperation,
  bangumiId: string,
  cfg: SourceConfig,
): Promise<unknown> {
  const signingKey = requireEgressSigningKey(cfg);
  const doFetch = signedEgressFetch(signingKey, cfg.fetchImpl ?? fetch, cfg.nowMs ?? Date.now);
  // `await`, not a bare `return`: a request the builder refuses (a bad bangumi
  // id) must reject through an awaited promise. Returning it defers handler
  // attachment by a microtask, which workerd reports as an unhandled rejection.
  return await fetchJson({ upstream: "anitabi", operation, bangumiId }, { ...cfg, fetchImpl: doFetch });
}

/** Read `litePoints` + `pointsLength` from a `/lite` body; empty on any miss. */
function parseLite(body: unknown): AnitabiLite {
  if (!isObject(body)) return { points: [], total: 0 };
  const raw = body.litePoints;
  const points = Array.isArray(raw) ? raw.filter(isObject) : [];
  return { points, total: liteTotal(body, points.length) };
}

/** Coerce `pointsLength` to a non-negative count; fall back to the preview size. */
function liteTotal(body: Record<string, unknown>, fallback: number): number {
  const len = body.pointsLength;
  return typeof len === "number" && Number.isFinite(len) && len >= 0 ? len : fallback;
}

/** Fetch the raw subject metadata for a bangumi id from Bangumi v0. */
export async function fetchBangumiSubject(
  bangumiId: string,
  cfg: SourceConfig = {},
): Promise<BangumiSubject> {
  const body = await fetchJson({ upstream: "bangumi", operation: "subject", bangumiId }, cfg);
  return expectObject(body);
}

/** Return Bangumi anime subjects in upstream relevance order, capped by `limit`. */
export async function fetchBangumiSubjects(
  keywords: string,
  cfg: BangumiSearchConfig = {},
): Promise<BangumiSearchSubject[]> {
  const limit = cfg.limit ?? BANGUMI_FETCH_N;
  const request: UpstreamRequest = { upstream: "bangumi", operation: "search-subjects", limit };
  const body = JSON.stringify({ keyword: keywords, filter: { type: [BANGUMI_TYPE_ANIME] } });
  return searchSubjects(await postJson(request, body, cfg), limit);
}

/** Resolve a title to the relevance-head subject id; retained for ingest preview. */
export async function fetchBangumiSearch(
  keywords: string,
  cfg: SourceConfig = {},
): Promise<string | null> {
  return fetchBangumiSubjects(keywords, { ...cfg, limit: 1 })
    .then((subjects) => subjects[0]?.id ?? null);
}

/** Bangumi subject type for anime (v0 `filter.type`); matches the Python client. */
const BANGUMI_TYPE_ANIME = 2;

/** Read valid subjects from a paged search body without changing relevance order. */
function searchSubjects(body: unknown, limit: number): BangumiSearchSubject[] {
  if (!isObject(body)) return [];
  const list = body.data;
  if (!Array.isArray(list)) return [];
  return list.filter(isObject).flatMap(normalizeSubject).slice(0, limit);
}

/** Normalize one subject id; omit malformed entries from the search result. */
function normalizeSubject(subject: Record<string, unknown>): BangumiSearchSubject[] {
  const id = subjectId(subject);
  return id ? [{ ...subject, id }] : [];
}

/** Coerce a subject's `id` (number or numeric string) to a string id, else null. */
function subjectId(subject: Record<string, unknown>): string | null {
  const id = subject.id;
  if (typeof id === "number") return String(id);
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** GET + JSON-decode with retry + status guarding; throws on a non-2xx response. */
export async function fetchJson(request: UpstreamRequest, cfg: SourceConfig = {}): Promise<unknown> {
  const url = upstreamUrlFor(request, cfg.bangumiBaseUrl ?? BANGUMI_BASE);
  const res = await fetchWithRetry(url, upstreamNameOf(request), cfg, { headers: { "User-Agent": ANITABI_USER_AGENT } });
  if (res.status === 404) throw new UpstreamNotFoundError(url);
  if (!res.ok) throw statusFailure(url, res.status, upstreamNameOf(request));
  return decodeJson(res, url, upstreamNameOf(request));
}

/** POST a JSON body + JSON-decode with retry + status guarding; throws on a non-2xx response. */
async function postJson(request: UpstreamRequest, body: string, cfg: SourceConfig = {}): Promise<unknown> {
  const url = upstreamUrlFor(request, cfg.bangumiBaseUrl ?? BANGUMI_BASE);
  const upstream = upstreamNameOf(request);
  const headers = { "User-Agent": ANITABI_USER_AGENT, "Content-Type": "application/json" };
  const res = await fetchWithRetry(url, upstream, cfg, { method: "POST", headers, body });
  if (!res.ok) throw statusFailure(url, res.status, upstream);
  return decodeJson(res, url, upstream);
}

/** Fetch with retry on transient failures; exhaustion rethrows as UpstreamFetchError. */
async function fetchWithRetry(
  url: string, upstream: ReturnType<typeof upstreamNameOf>, cfg: SourceConfig, init: Parameters<FetchLike>[1],
): Promise<Awaited<ReturnType<FetchLike>>> {
  const doFetch = cfg.fetchImpl ?? (fetch);
  try {
    return await withRetry(() => attemptFetch(doFetch, url, init), cfg.retry);
  } catch (err) {
    return upstreamError(url, upstream, err);
  }
}

function upstreamError(url: string, upstream: ReturnType<typeof upstreamNameOf>, err: unknown): never {
  if (!(err instanceof RetryableError)) throw err;
  const suffix = err.status !== undefined ? ` (${String(err.status)})` : "";
  throw new UpstreamFetchError(`${url}${suffix}`, upstream, err.cause);
}

/** One attempt: transient statuses/transport errors signal a retry; others pass through. */
async function attemptFetch(
  doFetch: FetchLike, url: string, init: Parameters<FetchLike>[1],
): Promise<Awaited<ReturnType<FetchLike>>> {
  try {
    return await fetchOnce(doFetch, url, init);
  } catch (err) {
    // An egress refusal is OUR service refusing — final, never retried
    // (the ceiling clears on its own within the hour); it must not be
    // mistaken for a transient upstream fault (#1792).
    if (err instanceof EgressRefusedError) throw err;
    throw err instanceof RetryableError ? err : new RetryableError(undefined, undefined, err);
  }
}

async function fetchOnce(
  doFetch: FetchLike,
  url: string,
  init: Parameters<FetchLike>[1],
): Promise<Awaited<ReturnType<FetchLike>>> {
  const res = await doFetch(url, init);
  checkRetryable(res);
  return res;
}

function checkRetryable(res: Awaited<ReturnType<FetchLike>>): void {
  if (!isRetryableStatus(res.status)) return;
  const delay = parseRetryAfter(res.headers?.get("retry-after") ?? null, Date.now()) ?? undefined;
  throw new RetryableError(res.status, delay);
}

/** Convert malformed response bodies into source-aware upstream failures. */
async function decodeJson(res: Awaited<ReturnType<FetchLike>>, url: string, upstream: ReturnType<typeof upstreamNameOf>): Promise<unknown> {
  try {
    return await res.json();
  } catch (err) {
    throw new UpstreamFetchError(url, upstream, err);
  }
}

/** Normalize Anitabi's {data|points: [...]} / bare-array shapes to a point list. */
function normalizePoints(body: unknown): AnitabiPoint[] {
  if (Array.isArray(body)) return body.filter(isObject);
  if (!isObject(body)) throw new Error("Unexpected Anitabi response structure");
  const list = body.data ?? body.points;
  if (Array.isArray(list)) return list.filter(isObject);
  throw new Error("Unexpected Anitabi response structure");
}

/** Narrow an unknown JSON value to a plain object, else throw. */
function expectObject(body: unknown): Record<string, unknown> {
  if (!isObject(body)) throw new Error("Expected a JSON object response");
  return body;
}

/** Type guard: a non-null, non-array object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
