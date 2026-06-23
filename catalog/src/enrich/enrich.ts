/**
 * Enrich stage (card W3-2): raw zone -> published catalog.
 *
 * Composes the committed kernels into one work-scoped pass:
 *   1. read raw_bangumi + raw_anitabi for the work (throw if either is absent);
 *   2. parse -> UPSERT the `bangumi` row + the `points` rows (raw `sql`, ON
 *      CONFLICT (id) so a re-enrich from raw is idempotent — no dup rows);
 *   3. cluster the points (clusterByLocation, 50m). The `points` table has NO
 *      cluster_id column (see remote_schema.sql), so clusters are COMPUTED and
 *      counted here, NOT persisted — route planning re-clusters at query time
 *      (O(n^2)/work). Persisting cluster_id (or centroids into route_snapshots)
 *      is a deliberate later-wave decision, not an oversight;
 *   4. build aliases from the bangumi title(s) -> rankAliases -> UPSERT. Only the
 *      Bangumi source is wired here; AniDB/Moegirl/Manual arrive via later ingest;
 *   5. publishVersion() to atomically bump cluster_version (blue/green switch).
 *
 * Writes go through raw `sql` (the Drizzle read schema is query-only), parameterized
 * to keep the JSON trust boundary safe. Each function stays <=10 lines.
 *
 * KNOWN GAP: enrich only UPSERTs; a point REMOVED upstream is not deleted and
 * lingers in the served catalog (delete-not-in-set is a later-wave fix).
 * LATER / optional (noted, NOT built): city_backfill, series-edge graph, and
 * quality-isolation of low-confidence points.
 */
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { clusterByLocation } from "../lib/clustering";
import { rankAliases, Source, type RankedAlias, type RawAlias } from "../lib/alias";
import { publishVersion } from "../publish/versioning";
import {
  parseAnitabiPoints,
  parseBangumi,
  type BangumiRow,
  type PointRow,
} from "./parse";

/** Outcome of enriching one work: the published version + point count. */
export interface EnrichResult {
  version: number;
  pointCount: number;
}

/** Enrich one work from its raw zone, then publish a new catalog version. */
export async function enrichWork(db: CatalogDb, workId: string): Promise<EnrichResult> {
  const bangumi = parseBangumi(workId, await readRaw(db, "raw_bangumi", workId));
  const points = parseAnitabiPoints(workId, await readRaw(db, "raw_anitabi", workId));
  logClusters(workId, points);
  return db.transaction(async (tx) => {
    await upsertBangumi(tx, bangumi);
    await upsertPoints(tx, points);
    await upsertAliases(tx, workId, bangumi);
    return { version: await publishVersion(tx, workId), pointCount: points.length };
  });
}

/** Read a raw-zone payload for the work; throw if the row is absent. */
async function readRaw(
  db: CatalogDb,
  table: "raw_anitabi" | "raw_bangumi",
  workId: string,
): Promise<unknown> {
  const rows = (
    await db.execute(sql`SELECT payload FROM ${sql.raw(table)} WHERE work_id = ${workId}`)
  ).rows as Array<{ payload: unknown }>;
  if (rows.length === 0) throw new Error(`No ${table} payload for work ${workId}`);
  return rows[0]!.payload;
}

/** UPSERT the `bangumi` row keyed by id (re-enrich overwrites in place). */
async function upsertBangumi(db: CatalogDb, row: BangumiRow): Promise<void> {
  await db.execute(sql`
    INSERT INTO bangumi (id, title, title_cn, cover_url, summary, rating, eps_count, air_date)
    VALUES (${row.id}, ${row.title}, ${row.title_cn}, ${row.cover_url},
            ${row.summary}, ${row.rating}, ${row.eps_count}, ${row.air_date})
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title, title_cn = EXCLUDED.title_cn, cover_url = EXCLUDED.cover_url,
      summary = EXCLUDED.summary, rating = EXCLUDED.rating,
      eps_count = EXCLUDED.eps_count, air_date = EXCLUDED.air_date
  `);
}

/** UPSERT every point row keyed by id (idempotent re-enrich, no duplicates). */
async function upsertPoints(db: CatalogDb, rows: PointRow[]): Promise<void> {
  for (const row of rows) await upsertPoint(db, row);
}

/** UPSERT one `points` row; the sync_points_coordinates trigger fills location. */
async function upsertPoint(db: CatalogDb, row: PointRow): Promise<void> {
  await db.execute(sql`
    INSERT INTO points (id, bangumi_id, name, name_cn, latitude, longitude,
                        image, episode, time_seconds, origin, origin_url)
    VALUES (${row.id}, ${row.bangumi_id}, ${row.name}, ${row.name_cn},
            ${row.latitude}, ${row.longitude}, ${row.image}, ${row.episode},
            ${row.time_seconds}, ${row.origin}, ${row.origin_url})
    ON CONFLICT (id) DO UPDATE SET
      bangumi_id = EXCLUDED.bangumi_id, name = EXCLUDED.name, name_cn = EXCLUDED.name_cn,
      latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, image = EXCLUDED.image,
      episode = EXCLUDED.episode, time_seconds = EXCLUDED.time_seconds,
      origin = EXCLUDED.origin, origin_url = EXCLUDED.origin_url
  `);
}

/** Compute 50m clusters (no cluster_id column to persist) and log the count. */
function logClusters(workId: string, points: PointRow[]): number {
  const clusters = clusterByLocation(points, 50);
  console.info(`enrich ${workId}: ${points.length} points -> ${clusters.length} clusters`);
  return clusters.length;
}

/** Rank the work's title aliases and UPSERT them into the `aliases` table. */
async function upsertAliases(db: CatalogDb, workId: string, b: BangumiRow): Promise<void> {
  const ranked = rankAliases(titleAliases(b));
  for (const a of ranked) await upsertAlias(db, workId, a);
}

/** Collect candidate aliases from the bangumi title fields (Bangumi source). */
function titleAliases(b: BangumiRow): RawAlias[] {
  const raw: RawAlias[] = [{ alias: b.title, source: Source.Bangumi }];
  if (b.title_cn) raw.push({ alias: b.title_cn, source: Source.Bangumi });
  return raw;
}

/** UPSERT one alias row keyed by (work_id, alias, source). */
async function upsertAlias(db: CatalogDb, workId: string, a: RankedAlias): Promise<void> {
  await db.execute(sql`
    INSERT INTO aliases (work_id, alias, alias_normalized, source, priority)
    VALUES (${workId}, ${a.alias}, ${a.alias_normalized}, ${a.source}, ${a.priority})
    ON CONFLICT (work_id, alias, source)
    DO UPDATE SET alias_normalized = EXCLUDED.alias_normalized, priority = EXCLUDED.priority
  `);
}
