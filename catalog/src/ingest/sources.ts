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
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Injectable knobs for the source fetchers (defaulted for prod). */
export interface SourceConfig {
  fetchImpl?: FetchLike;
  anitabiBaseUrl?: string;
  bangumiBaseUrl?: string;
}

const ANITABI_BASE = "https://api.anitabi.cn/bangumi";
const BANGUMI_BASE = "https://api.bgm.tv";
const USER_AGENT =
  "Seichijunrei/1.0 (https://github.com/lifeodyssey/Seichijunrei-agent)";

/** A single raw Anitabi point (legacy or official schema; kept verbatim). */
export type AnitabiPoint = Record<string, unknown>;

/** A raw Bangumi subject object (kept verbatim for the raw zone). */
export type BangumiSubject = Record<string, unknown>;

/** Fetch the raw pilgrimage point list for a bangumi id from Anitabi. */
export async function fetchAnitabiPoints(
  bangumiId: string,
  cfg: SourceConfig = {},
): Promise<AnitabiPoint[]> {
  const base = cfg.anitabiBaseUrl ?? ANITABI_BASE;
  const url = `${base}/${bangumiId}/points/detail?haveImage=true`;
  const body = await fetchJson(url, cfg.fetchImpl);
  return normalizePoints(body);
}

/** Fetch the raw subject metadata for a bangumi id from Bangumi v0. */
export async function fetchBangumiSubject(
  bangumiId: string,
  cfg: SourceConfig = {},
): Promise<BangumiSubject> {
  const base = cfg.bangumiBaseUrl ?? BANGUMI_BASE;
  const url = `${base}/v0/subjects/${bangumiId}`;
  const body = await fetchJson(url, cfg.fetchImpl);
  return expectObject(body);
}

/** GET + JSON-decode with status guarding; throws on a non-2xx response. */
async function fetchJson(url: string, fetchImpl?: FetchLike): Promise<unknown> {
  const doFetch = fetchImpl ?? (fetch as unknown as FetchLike);
  const res = await doFetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Upstream fetch failed (${res.status}): ${url}`);
  return res.json();
}

/** Normalize Anitabi's {data|points: [...]} / bare-array shapes to a point list. */
function normalizePoints(body: unknown): AnitabiPoint[] {
  if (Array.isArray(body)) return body.filter(isObject);
  if (!isObject(body)) throw new Error("Unexpected Anitabi response structure");
  const list = body["data"] ?? body["points"];
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
