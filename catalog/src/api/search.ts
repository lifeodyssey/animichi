/**
 * Catalog `search` read API: free-text query -> pilgrimage points.
 *
 * Resolves the query through the alias index (NFKC-folded exact match on
 * `aliases.alias_normalized`, the same key `catalog/src/lib/alias.ts` writes)
 * to a `work_id` (a Bangumi subject id), then returns that work's `points`
 * joined to its `bangumi` metadata for the anime title.
 *
 * On an alias MISS (an uncovered work) this resolves the title on demand: it
 * asks the Bangumi search API for the best-match subject id, then ingests that
 * work end-to-end and returns its freshly-published points. The agent stays
 * upstream-free — only the catalog ever touches Anitabi/Bangumi. A title that
 * Bangumi can't resolve (or whose ingest is in-progress/empty/failed) yields
 * `{ rows: [] }`. The L1 fast-preview tier and SSE ingest-progress streaming are
 * FOLLOW-UPS; this is the synchronous miss -> resolve -> ingest -> return path.
 *
 * Output mirrors the oRPC contract `SearchResult` / `PilgrimagePoint`. The wire
 * shapes (`Origin` / `PilgrimagePoint`) come from `../types` — the single
 * in-Worker mirror of `packages/contract/src/models.ts`. `import type` erases at
 * compile time, keeping the contract's zod runtime out of the Worker bundle;
 * they are re-exported so existing consumers keep importing them from here.
 */

import { desc, eq } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { aliases, bangumi, points } from "../db/schema";
import { normalizeAlias } from "../lib/alias";
import { ingestWork } from "../ingest/orchestrator";
import { fetchBangumiSearch, type FetchLike } from "../ingest/sources";
import type { Origin, PilgrimagePoint } from "../types";

export type { Origin, PilgrimagePoint };

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
  synced_at: Date | null;
}

/**
 * The minimal DB surface `search` depends on. `CatalogDb` (the production
 * Drizzle client) satisfies it via `searchDb(db)`; tests inject a fake.
 *
 * `resolveAndIngest` is the on-demand miss path: resolve the title via the
 * Bangumi search API, then ingest the work end-to-end. It returns the ingested
 * work's id on `status:"ingested"`, else null (no-result / in-progress / empty /
 * failed) so the handler can short-circuit to empty rows.
 */
export interface SearchDb {
  workIdForAlias(aliasNormalized: string): Promise<string | undefined>;
  pointsForWork(workId: string): Promise<WorkPointRow[]>;
  resolveAndIngest(query: string, fetchImpl?: FetchLike): Promise<string | null>;
}

/** Resolve a free-text query to a work's pilgrimage points. */
export async function search(
  db: SearchDb,
  input: { query: string; origin?: Origin },
  fetchImpl?: FetchLike,
): Promise<{ rows: PilgrimagePoint[]; synced_at: string }> {
  const workId =
    (await db.workIdForAlias(normalizeAlias(input.query))) ??
    (await db.resolveAndIngest(input.query, fetchImpl));
  if (!workId) {
    return { rows: [], synced_at: new Date().toISOString() };
  }
  const rows = await db.pointsForWork(workId);
  return { rows: rows.map(toPoint), synced_at: syncedAt(rows) };
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
  return { latitude: Number(r.latitude), longitude: Number(r.longitude) };
}

/** Optional metadata fields, omitted when null. */
function meta(r: WorkPointRow): Partial<PilgrimagePoint> {
  return {
    ...(r.name_cn != null ? { name_cn: r.name_cn } : {}),
    ...(r.episode != null ? { episode: r.episode } : {}),
    ...(r.time_seconds != null ? { time_seconds: r.time_seconds } : {}),
    ...(r.title != null ? { title: r.title } : {}),
    ...(r.title_cn != null ? { title_cn: r.title_cn } : {}),
  };
}

/** `synced_at` from the work's `bangumi.updated_at`, else now. */
function syncedAt(rows: WorkPointRow[]): string {
  const stamp = rows[0]?.synced_at;
  return (stamp ?? new Date()).toISOString();
}

/** Build the production `SearchDb` over a Drizzle `CatalogDb`. */
export function searchDb(db: CatalogDb): SearchDb {
  return {
    workIdForAlias: (normalized) => firstWorkId(db, normalized),
    pointsForWork: (workId) => selectPoints(db, workId),
    resolveAndIngest: (query, fetchImpl) => resolveAndIngest(db, query, fetchImpl),
  };
}

/** Bangumi-resolve the uncovered title, then ingest it; the work id, else null. */
async function resolveAndIngest(
  db: CatalogDb,
  query: string,
  fetchImpl?: FetchLike,
): Promise<string | null> {
  const bangumiId = await fetchBangumiSearch(query, { fetchImpl });
  if (!bangumiId) return null;
  const result = await ingestWork(db, bangumiId, { fetchImpl });
  return result.status === "ingested" ? bangumiId : null;
}

/** Exact-match the normalized alias -> the highest-priority work id. */
async function firstWorkId(db: CatalogDb, normalized: string): Promise<string | undefined> {
  const found = await db
    .select({ workId: aliases.workId })
    .from(aliases)
    .where(eq(aliases.aliasNormalized, normalized))
    .orderBy(desc(aliases.priority))
    .limit(1);
  return found[0]?.workId;
}

/** Select the work's points joined to its bangumi title metadata. */
async function selectPoints(db: CatalogDb, workId: string): Promise<WorkPointRow[]> {
  return db
    .select({
      id: points.id,
      name: points.name,
      name_cn: points.nameCn,
      bangumi_id: points.bangumiId,
      episode: points.episode,
      time_seconds: points.timeSeconds,
      image: points.image,
      latitude: points.latitude,
      longitude: points.longitude,
      title: bangumi.title,
      title_cn: bangumi.titleCn,
      synced_at: bangumi.updatedAt,
    })
    .from(points)
    .leftJoin(bangumi, eq(points.bangumiId, bangumi.id))
    .where(eq(points.bangumiId, workId));
}
