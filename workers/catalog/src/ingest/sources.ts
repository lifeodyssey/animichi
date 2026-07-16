/**
 * Upstream source fetchers for the ingest pipeline.
 *
 * Ported from the Python clients (`backend/clients/anitabi.py`,
 * `backend/clients/bangumi.py`): same endpoints/params, but Workers-native
 * `fetch` instead of the Python retry/cache stack (a later wave owns retry).
 *
 *   Anitabi : GET {base}/{id}/points/detail?haveImage=true  (base api.anitabi.cn/bangumi)
 *             -> raw point list (legacy lat/lng or official geo[] schema).
 *   Bangumi : GET {base}/v0/subjects/{id}                   (base api.bgm.tv)
 *             -> subject metadata object.
 *
 * The base URL and `fetch` are injectable so tests drive a mock and never hit
 * the network. Return shapes are the verbatim upstream JSON (object / array),
 * destined straight for the raw zone — parsing/enrich is downstream.
 */

/** Minimal fetch surface we depend on; satisfied by the global `fetch`. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Injectable knobs for the source fetchers (defaulted for prod). */
export interface SourceConfig {
  fetchImpl?: FetchLike;
  anitabiBaseUrl?: string;
  bangumiBaseUrl?: string;
}

/** Search-specific Bangumi knobs; `limit` is sent as a query parameter. */
export interface BangumiSearchConfig extends SourceConfig {
  limit?: number;
}

/** Upstream identity retained on transport failures for typed boundary mapping. */
export type UpstreamName = "anitabi" | "bangumi";

const ANITABI_BASE = "https://api.anitabi.cn/bangumi";
const BANGUMI_BASE = "https://api.bgm.tv";
const USER_AGENT =
  "Animichi/1.0 (https://github.com/lifeodyssey/animichi)";

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

const BANGUMI_ID_RE = /^\d+$/;
export const BANGUMI_FETCH_N = 8;

/** A 404 from an upstream source: the resource has no data, NOT a transient
 * outage. Callers that treat "no data" as an empty result catch THIS
 * specifically; every other failure stays a generic (retryable) error. */
export class UpstreamNotFoundError extends Error {
  constructor(readonly url: string) {
    super(`Upstream resource not found (404): ${url}`);
    this.name = "UpstreamNotFoundError";
  }
}

/** A transport or non-2xx failure distinct from a real upstream 404. */
export class UpstreamFetchError extends Error {
  constructor(readonly url: string, readonly upstream: UpstreamName, cause?: unknown) {
    super(`Upstream fetch failed: ${url}`, { cause });
    this.name = "UpstreamFetchError";
  }
}

/** Throw if `bangumiId` is not a pure numeric string (prevents path injection). */
function assertBangumiId(bangumiId: string): void {
  if (!BANGUMI_ID_RE.test(bangumiId)) {
    throw new Error(String.raw`Invalid bangumi_id: "${bangumiId}" — must match /^\d+$/`);
  }
}

/** Fetch the raw pilgrimage point list for a bangumi id from Anitabi. */
export async function fetchAnitabiPoints(
  bangumiId: string,
  cfg: SourceConfig = {},
): Promise<AnitabiPoint[]> {
  assertBangumiId(bangumiId);
  const base = cfg.anitabiBaseUrl ?? ANITABI_BASE;
  const url = `${base}/${bangumiId}/points/detail?haveImage=true`;
  const body = await fetchJson(url, "anitabi", cfg.fetchImpl);
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
  assertBangumiId(bangumiId);
  const base = cfg.anitabiBaseUrl ?? ANITABI_BASE;
  const body = await fetchJson(`${base}/${bangumiId}/lite`, "anitabi", cfg.fetchImpl);
  return parseLite(body);
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
  assertBangumiId(bangumiId);
  const base = cfg.bangumiBaseUrl ?? BANGUMI_BASE;
  const url = `${base}/v0/subjects/${bangumiId}`;
  const body = await fetchJson(url, "bangumi", cfg.fetchImpl);
  return expectObject(body);
}

/** Return Bangumi anime subjects in upstream relevance order, capped by `limit`. */
export async function fetchBangumiSubjects(
  keywords: string,
  cfg: BangumiSearchConfig = {},
): Promise<BangumiSearchSubject[]> {
  const limit = searchLimit(cfg.limit ?? BANGUMI_FETCH_N);
  const base = cfg.bangumiBaseUrl ?? BANGUMI_BASE;
  const body = JSON.stringify({ keyword: keywords, filter: { type: [BANGUMI_TYPE_ANIME] } });
  const url = `${base}/v0/search/subjects?limit=${String(limit)}&offset=0`;
  return searchSubjects(await postJson(url, body, "bangumi", cfg.fetchImpl), limit);
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

/** Validate the adapter's internal result cap before interpolating it into the URL. */
function searchLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Bangumi search limit must be a positive integer");
  return limit;
}

/** GET + JSON-decode with status guarding; throws on a non-2xx response. */
async function fetchJson(url: string, upstream: UpstreamName, fetchImpl?: FetchLike): Promise<unknown> {
  const doFetch = fetchImpl ?? (fetch);
  const res = await request(doFetch, url, upstream, { headers: { "User-Agent": USER_AGENT } });
  if (res.status === 404) throw new UpstreamNotFoundError(url);
  if (!res.ok) throw new UpstreamFetchError(`${url} (${String(res.status)})`, upstream);
  return res.json();
}

/** POST a JSON body + JSON-decode with status guarding; throws on a non-2xx response. */
async function postJson(url: string, body: string, upstream: UpstreamName, fetchImpl?: FetchLike): Promise<unknown> {
  const doFetch = fetchImpl ?? (fetch);
  const headers = { "User-Agent": USER_AGENT, "Content-Type": "application/json" };
  const res = await request(doFetch, url, upstream, { method: "POST", headers, body });
  if (!res.ok) throw new UpstreamFetchError(`${url} (${String(res.status)})`, upstream);
  return res.json();
}

/** Convert network failures into a transport-specific error for source-aware callers. */
async function request(doFetch: FetchLike, url: string, upstream: UpstreamName, init: Parameters<FetchLike>[1]) {
  try {
    return await doFetch(url, init);
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
