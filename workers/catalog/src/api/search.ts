/**
 * Catalog `search` read API: free-text query -> pilgrimage points.
 *
 * Resolves the query through the alias index (NFKC-folded exact match on
 * `aliases.alias_normalized`, the same key `catalog/src/lib/alias.ts` writes)
 * to a `work_id` (a Bangumi subject id), then returns that work's `points`
 * joined to its `bangumi` metadata for the anime title.
 *
 * On an alias MISS (an uncovered work) this is TIERED so workerd never blocks on
 * the full ingest (fetch ~68 points + enrich + publish exceeds the request
 * limit -> a hung 500):
 *   - resolve the title to a Bangumi subject id (fast);
 *   - fetch the Anitabi `/lite` preview (the first ~10 points, fast) and return
 *     those IMMEDIATELY as the L1 preview, flagged `partial:true`;
 *   - schedule the FULL `ingestWork` in the background via the request's
 *     `ExecutionContext.waitUntil`, so the response returns before it finishes.
 * When no `waitUntil` is available (tests / integration harnesses without an
 * execution context) it FALLS BACK to running the full ingest synchronously —
 * the prior behavior — so nothing breaks. The agent stays upstream-free; only
 * the catalog ever touches Anitabi/Bangumi. A title Bangumi can't resolve (or
 * whose lite preview is empty) yields `{ rows: [] }`.
 *
 * Output mirrors the oRPC contract `SearchResult` / `PilgrimagePoint`. The wire
 * shapes (`Origin` / `PilgrimagePoint`) come from `../types` — the single
 * in-Worker mirror of `packages/contract/src/models.ts`. `import type` erases at
 * compile time, keeping the contract's zod runtime out of the Worker bundle;
 * they are re-exported so existing consumers keep importing them from here.
 */

import { sql } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { normalizeAlias } from "../lib/alias";
import { optional } from "../lib/optional";
import { ingestWork } from "../ingest/orchestrator";
import {
  fetchAnitabiLite,
  fetchBangumiSearch,
  type AnitabiPoint,
  type FetchLike,
} from "../ingest/sources";
import type { Origin, PilgrimagePoint } from "../types";

export type { Origin, PilgrimagePoint };

/** A resolved-but-uncovered work: its Bangumi id + the L1 lite preview points. */
export interface MissPreview {
  workId: string;
  points: PilgrimagePoint[];
}

/** Knobs for the search miss path: the injectable `fetch` + the background hook. */
export interface SearchOptions {
  fetchImpl?: FetchLike;
  /** `ExecutionContext.waitUntil` — when set, the full ingest runs in the
   * background and an L1 preview returns immediately; when absent the full
   * ingest runs synchronously (the prior behavior). */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** A point row joined to its parent work's title, as read from Postgres. */
export interface WorkPointRow {
  id: string;
  name: string;
  name_cn: string | null;
  bangumi_id: string | null;
  episode: number | null;
  time_seconds: number | null;
  image: string | null;
  latitude: number;
  longitude: number;
  title: string | null;
  title_cn: string | null;
  cover_url: string | null;
  // workerd's raw pg returns timestamptz as a string (Node parses it to Date) — accept both.
  synced_at: Date | string | null;
}

/**
 * The minimal DB surface `search` depends on. `CatalogDb` (the production
 * Drizzle client) satisfies it via `searchDb(db)`; tests inject a fake.
 *
 * The miss path is split into two so the handler can return the fast preview
 * before the slow ingest finishes:
 *   - `resolvePreview`: resolve the title via Bangumi search, then fetch the
 *     Anitabi `/lite` preview (first ~10 points). Returns the work id + preview
 *     points, or null (unresolvable / empty preview) so the handler returns
 *     empty rows. FAST — no enrich/publish.
 *   - `runFullIngest`: the full `ingestWork` (fetch all points -> enrich ->
 *     publish), run in the background via `waitUntil` (or synchronously in the
 *     fallback). The published points then serve subsequent (alias-hit) reads.
 */
export interface SearchDb {
  workIdForAlias(aliasNormalized: string): Promise<string | undefined>;
  pointsForWork(workId: string): Promise<WorkPointRow[]>;
  resolvePreview(query: string, fetchImpl?: FetchLike): Promise<MissPreview | null>;
  runFullIngest(workId: string, fetchImpl?: FetchLike): Promise<void>;
}

/** The search response: rows + freshness, plus `partial` when these are an L1 preview. */
export interface SearchResult {
  rows: PilgrimagePoint[];
  synced_at: string;
  partial?: boolean;
}

/** Resolve a free-text query to a work's pilgrimage points. */
export async function search(
  db: SearchDb,
  input: { query: string; origin?: Origin },
  opts: SearchOptions = {},
): Promise<SearchResult> {
  const workId = await db.workIdForAlias(normalizeAlias(input.query));
  if (workId) return hitResult(db, workId);
  return missResult(db, input.query, opts);
}

/** Alias HIT: return the work's published points from the catalog (no preview/ingest). */
async function hitResult(db: SearchDb, workId: string): Promise<SearchResult> {
  const rows = await db.pointsForWork(workId);
  return { rows: rows.map(toPoint), synced_at: syncedAt(rows) };
}

/** Alias MISS: resolve + L1 preview now, full ingest in the background (or sync fallback). */
async function missResult(
  db: SearchDb,
  query: string,
  opts: SearchOptions,
): Promise<SearchResult> {
  const preview = await db.resolvePreview(query, opts.fetchImpl);
  if (!preview) return emptyResult();
  if (!opts.waitUntil) return syncFallback(db, preview, opts.fetchImpl);
  opts.waitUntil(db.runFullIngest(preview.workId, opts.fetchImpl));
  return { rows: preview.points, synced_at: new Date().toISOString(), partial: true };
}

/** No `waitUntil`: run the full ingest synchronously, then read the published points. */
async function syncFallback(
  db: SearchDb,
  preview: MissPreview,
  fetchImpl?: FetchLike,
): Promise<SearchResult> {
  await db.runFullIngest(preview.workId, fetchImpl);
  const rows = await db.pointsForWork(preview.workId);
  if (rows.length > 0) return { rows: rows.map(toPoint), synced_at: syncedAt(rows) };
  return { rows: preview.points, synced_at: new Date().toISOString(), partial: true };
}

/** The empty-result shape (unresolvable title / empty preview). */
function emptyResult(): SearchResult {
  return { rows: [], synced_at: new Date().toISOString() };
}

/** Map a joined DB row to the contract `PilgrimagePoint` shape. */
function toPoint(r: WorkPointRow): PilgrimagePoint {
  return {
    ...identity(r),
    ...geo(r),
    ...meta(r),
  };
}

/** Required identity fields (id / name / bangumi_id / screenshot_url). */
function identity(r: WorkPointRow): Pick<PilgrimagePoint, "id" | "name" | "bangumi_id" | "screenshot_url"> {
  return { id: r.id, name: r.name, bangumi_id: r.bangumi_id ?? "", screenshot_url: r.image ?? "" };
}

/** Required geo fields. */
function geo(r: WorkPointRow): Pick<PilgrimagePoint, "latitude" | "longitude"> {
  return { latitude: r.latitude, longitude: r.longitude };
}

/** Optional metadata fields, omitted when null. */
function meta(r: WorkPointRow): Partial<PilgrimagePoint> {
  return optional({
    name_cn: r.name_cn,
    episode: r.episode,
    time_seconds: r.time_seconds,
    title: r.title,
    title_cn: r.title_cn,
    cover_url: r.cover_url,
  });
}

/** `synced_at` from the work's `bangumi.updated_at`, else now. Accepts a Date or
 * a raw timestamptz string (workerd's pg driver does not parse it to a Date). */
function syncedAt(rows: WorkPointRow[]): string {
  const stamp = rows[0]?.synced_at;
  return stamp ? new Date(stamp).toISOString() : new Date().toISOString();
}

/** Build the production `SearchDb` over a Drizzle `CatalogDb`. */
export function searchDb(db: CatalogDb): SearchDb {
  return {
    workIdForAlias: (normalized) => firstWorkId(db, normalized),
    pointsForWork: (workId) => selectPoints(db, workId),
    resolvePreview: (query, fetchImpl) => resolvePreview(query, fetchImpl),
    runFullIngest: (workId, fetchImpl) => runFullIngest(db, workId, fetchImpl),
  };
}

/** Resolve an uncovered title to its Bangumi id + the fast Anitabi `/lite`
 * preview points; null when Bangumi can't resolve it, the preview is empty, or
 * an upstream call fails. An upstream hiccup must NOT 500 the search — it
 * degrades to empty rows, the same resilience the prior ingest-backed path had. */
async function resolvePreview(
  query: string,
  fetchImpl?: FetchLike,
): Promise<MissPreview | null> {
  try {
    return await resolvePreviewUnsafe(query, fetchImpl);
  } catch {
    return null;
  }
}

/** Resolve id -> lite preview; may throw on an upstream error (caller guards). */
async function resolvePreviewUnsafe(
  query: string,
  fetchImpl?: FetchLike,
): Promise<MissPreview | null> {
  const bangumiId = await fetchBangumiSearch(query, { fetchImpl });
  if (!bangumiId) return null;
  const lite = await fetchAnitabiLite(bangumiId, { fetchImpl });
  if (lite.points.length === 0) return null;
  return { workId: bangumiId, points: lite.points.map((p) => litePoint(p, bangumiId)) };
}

/** The FULL ingest (fetch all points -> enrich -> publish); swallows the result
 * (it is fire-and-forget on `waitUntil`, and synchronous callers re-read the DB). */
async function runFullIngest(
  db: CatalogDb,
  workId: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  await ingestWork(db, workId, { fetchImpl });
}

/** Map one Anitabi `/lite` point (official geo[] schema) to a `PilgrimagePoint`. */
function litePoint(p: AnitabiPoint, bangumiId: string): PilgrimagePoint {
  const [lat, lng] = liteGeo(p.geo);
  return {
    id: liteStr(p.id),
    name: liteStr(p.name),
    bangumi_id: bangumiId,
    screenshot_url: liteImage(p.image),
    latitude: lat,
    longitude: lng,
    ...optional({ episode: liteInt(p.ep), time_seconds: liteInt(p.s) }),
  };
}

/** Read `geo: [lat, lng]` as numbers; [0, 0] when absent/short. */
function liteGeo(raw: unknown): [number, number] {
  if (!Array.isArray(raw) || raw.length < 2) return [0, 0];
  return [Number(raw[0]) || 0, Number(raw[1]) || 0];
}

/** Resolve a lite point image, prefixing the Anitabi CDN host for relative paths. */
function liteImage(raw: unknown): string {
  const url = liteStr(raw);
  if (url.startsWith("/")) return `https://image.anitabi.cn${url}`;
  return url;
}

/** Coerce an unknown to a string ("" when absent). */
function liteStr(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/** Coerce an unknown to a finite integer, else null (so `optional` omits it). */
function liteInt(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : null;
}

/** Exact-match the normalized alias -> the highest-priority work id.
 * Raw `sql` (not the Drizzle query builder) — the builder hangs under workerd. */
async function firstWorkId(db: CatalogDb, normalized: string): Promise<string | undefined> {
  const result = await db.execute(
    sql`SELECT work_id FROM aliases WHERE alias_normalized = ${normalized} ORDER BY priority DESC LIMIT 1`,
  );
  return (result.rows as { work_id: string }[])[0]?.work_id;
}

/** Select the work's points joined to its bangumi title metadata. */
async function selectPoints(db: CatalogDb, workId: string): Promise<WorkPointRow[]> {
  const result = await db.execute(sql`
    SELECT p.id, p.name, p.name_cn, p.bangumi_id, p.episode, p.time_seconds,
           p.image, p.latitude, p.longitude, b.title, b.title_cn,
           b.cover_url, b.updated_at AS synced_at
    FROM points p LEFT JOIN bangumi b ON p.bangumi_id = b.id
    WHERE p.bangumi_id = ${workId}
  `);
  return result.rows as unknown as WorkPointRow[];
}
