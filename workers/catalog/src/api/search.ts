// TODO(refactor-skeleton): vertical slice — structure design catalog #837/#838
/**
 * Catalog `search` read API: free-text query -> pilgrimage points.
 *
 * Resolves the query through the alias index (NFKC-folded exact match on
 * `aliases.alias_normalized`, the same key `catalog/src/lib/alias.ts` writes)
 * to a `bangumi_id` (a Bangumi subject id), then returns that work's `points`
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
 * whose lite preview is empty) yields `{ rows: [] }`; an upstream outage now
 * surfaces as a defined retryable `UPSTREAM_UNAVAILABLE` oRPC error (502
 * envelope) instead of lying to the user with empty rows.
 *
 * Output mirrors the oRPC contract `SearchResult` / `Point`. The wire
 * shapes (`Origin` / `Point`) come from `../types` — the single
 * in-Worker mirror of `packages/contract/src/models.ts`. `import type` erases at
 * compile time, keeping the contract's zod runtime out of the Worker bundle;
 * they are re-exported so existing consumers keep importing them from here.
 */

import { sql } from "drizzle-orm";
import { bangumiPoints } from "../adapters/outbound/bangumi-points";
import { pointsByBangumi, type PublishedPointRow } from "../application/list-points-for-bangumi";
import type { CatalogDb } from "../db/client";
import { normalizeAlias } from "../lib/alias";
import { ingestWork } from "../ingest/orchestrator";
import type { FetchLike } from "../ingest/sources";
import type { Origin, Point, SearchResult } from "../types";
import { previewForQuery, type MissPreview } from "./preview";

export type { Origin, Point };

export type { MissPreview } from "./preview";

/** Knobs for the search miss path: the injectable `fetch` + the background hook. */
export interface SearchOptions {
  fetchImpl?: FetchLike;
  /** `ExecutionContext.waitUntil` — when set, the full ingest runs in the
   * background and an L1 preview returns immediately; when absent the full
   * ingest runs synchronously (the prior behavior). */
  waitUntil?: (promise: Promise<unknown>) => void;
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
  bangumiIdForAlias(aliasNormalized: string): Promise<string | undefined>;
  pointsForBangumi(bangumiId: string): Promise<PublishedPointRow[]>;
  resolvePreview(query: string, fetchImpl?: FetchLike): Promise<MissPreview | null>;
  runFullIngest(bangumiId: string, fetchImpl?: FetchLike): Promise<void>;
}

/** Resolve a free-text query to a work's pilgrimage points. */
export async function search(
  db: SearchDb,
  input: { query: string; origin?: Origin },
  opts: SearchOptions = {},
): Promise<SearchResult> {
  const bangumiId = await db.bangumiIdForAlias(normalizeAlias(input.query));
  if (bangumiId) return pointsByBangumi(db, bangumiId);
  return missResult(db, input.query, opts);
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
  return backgroundIngest(db, preview, opts);
}

/** Return the L1 preview now; full ingest keeps running after the response. */
function backgroundIngest(db: SearchDb, preview: MissPreview, opts: SearchOptions): SearchResult {
  opts.waitUntil?.(db.runFullIngest(preview.workId, opts.fetchImpl));
  return { rows: preview.points, synced_at: new Date().toISOString(), partial: true };
}

/** No `waitUntil`: run the full ingest synchronously, then read the published points. */
async function syncFallback(
  db: SearchDb,
  preview: MissPreview,
  fetchImpl?: FetchLike,
): Promise<SearchResult> {
  await db.runFullIngest(preview.workId, fetchImpl);
  const published = await pointsByBangumi(db, preview.workId);
  if (published.rows.length > 0) return published;
  return { rows: preview.points, synced_at: new Date().toISOString(), partial: true };
}

/** The empty-result shape (unresolvable title / empty preview). */
function emptyResult(): SearchResult {
  return { rows: [], synced_at: new Date().toISOString() };
}

/** Build the production `SearchDb` over a Drizzle `CatalogDb`. */
export function searchDb(db: CatalogDb): SearchDb {
  return {
    bangumiIdForAlias: (normalized) => firstBangumiId(db, normalized),
    pointsForBangumi: (bangumiId) => bangumiPoints(db).pointsForBangumi(bangumiId),
    resolvePreview: (query, fetchImpl) => previewForQuery(query, fetchImpl),
    runFullIngest: (bangumiId, fetchImpl) => runFullIngest(db, bangumiId, fetchImpl),
  };
}

/** The FULL ingest (fetch all points -> enrich -> publish); swallows the result
 * (it is fire-and-forget on `waitUntil`, and synchronous callers re-read the DB). */
async function runFullIngest(
  db: CatalogDb,
  bangumiId: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  await ingestWork(db, bangumiId, { fetchImpl });
}

/** Exact-match the normalized alias -> the highest-priority bangumi id.
 * Raw `sql` (not the Drizzle query builder) — the builder hangs under workerd. */
async function firstBangumiId(db: CatalogDb, normalized: string): Promise<string | undefined> {
  const result = await db.execute(
    sql`SELECT bangumi_id FROM aliases WHERE alias_normalized = ${normalized} ORDER BY priority DESC LIMIT 1`,
  );
  return (result.rows as { bangumi_id: string }[])[0]?.bangumi_id;
}
