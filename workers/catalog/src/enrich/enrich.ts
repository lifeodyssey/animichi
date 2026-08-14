/**
 * Enrich stage (card W3-2): raw zone -> published catalog.
 *
 * Composes the committed kernels into one work-scoped pass:
 *   1. read raw_bangumi + raw_anitabi for the work (throw if either is absent);
 *   2. parse -> UPSERT the `bangumi` row + the `points` rows (ON CONFLICT (id) so a
 *      re-enrich from raw is idempotent — no dup rows);
 *   3. cluster the points (clusterByLocation, 50m). The `points` table has NO
 *      cluster_id column (see remote_schema.sql), so clusters are COMPUTED and
 *      counted here, NOT persisted — route planning re-clusters at query time
 *      (O(n^2)/work). Persisting cluster_id (or centroids into route_snapshots)
 *      is a deliberate later-wave decision, not an oversight;
 *   4. build aliases from the bangumi title(s) -> rankAliases -> UPSERT. Only the
 *      Bangumi source is wired here; AniDB/Moegirl/Manual arrive via later ingest;
 *   5. append the ordered publish statements to the same atomic batch, bumping
 *      cluster_version as a blue/green pointer switch.
 *
 * Statements are built with the Drizzle query builder (array VALUES +
 * `onConflictDoUpdate`) over the single CatalogDb seam, parameterised to keep
 * the JSON trust boundary safe. Each function stays <=10 lines.
 *
 * KNOWN GAP: enrich only UPSERTs; a point REMOVED upstream is not deleted and
 * lingers in the served catalog (delete-not-in-set is a later-wave fix).
 * LATER / optional (noted, NOT built): city_backfill, series-edge graph, and
 * quality-isolation of low-confidence points.
 */
import { eq, sql, type SQL } from "drizzle-orm";
import type { CatalogDb, DbExecutor } from "../db/client";
import { statementBuilder } from "../db/client";
import { clusterByLocation } from "../domain/clustering/cluster";
import { rankAliases, Source, type RawAlias } from "../lib/alias";
import { publishVersionStatements, readPublishedVersion } from "../publish/versioning";
import {
  parseAnitabiPoints,
  parseBangumi,
  type BangumiRow,
  type PointRow,
} from "./parse";
import { aliases as aliasesTable, bangumi as bangumiTable, points as pointsTable, rawAnitabi, rawBangumi } from "../db/schema";

/** Outcome of enriching one work: the published version + point count. */
export interface EnrichResult {
  version: number;
  pointCount: number;
}

/** Enrich one work from its raw zone, then publish a new catalog version. */
export async function enrichWork(db: CatalogDb, bangumiId: string): Promise<EnrichResult> {
  const bangumi = parseBangumi(bangumiId, await readRaw(db, "raw_bangumi", bangumiId));
  const points = parseAnitabiPoints(bangumiId, await readRaw(db, "raw_anitabi", bangumiId));
  logClusters(bangumiId, points);
  const results = await db.batch(prepareBatch(db, enrichStatements(bangumiId, bangumi, points)));
  return { version: readPublishedVersion(lastResult(results)), pointCount: points.length };
}

/** Build every work mutation in its mandatory execution order. */
function enrichStatements(
  bangumiId: string, bangumi: BangumiRow, points: PointRow[],
): readonly [SQL, ...SQL[]] {
  return [
    upsertBangumi(bangumi), ...upsertPoints(points),
    upsertAliases(bangumiId, bangumi), ...publishVersionStatements(bangumiId),
  ];
}

/** Convert ordered SQL into lazy Drizzle batch items without executing them. */
function prepareBatch(db: CatalogDb, statements: readonly [SQL, ...SQL[]]) {
  const [first, ...rest] = statements;
  return [db.execute(first), ...rest.map((statement) => db.execute(statement))] as const;
}

/** The publish INSERT is always the final batch item. */
function lastResult(results: readonly { rows: unknown[] }[]): { rows: unknown[] } {
  const result = results.at(-1);
  if (!result) throw new Error("enrich batch returned no results");
  return result;
}

/** Read a raw-zone payload for the work; throw if the row is absent. */
async function readRaw(
  db: DbExecutor,
  table: "raw_anitabi" | "raw_bangumi",
  bangumiId: string,
): Promise<unknown> {
  const rows = await rawPayloadRows(db, table, bangumiId);
  const first = rows[0];
  if (first === undefined) throw new Error(`No ${table} payload for work ${bangumiId}`);
  return first.payload;
}

async function rawPayloadRows(
  db: DbExecutor,
  table: "raw_anitabi" | "raw_bangumi",
  bangumiId: string,
): Promise<{ payload: unknown }[]> {
  const source = table === "raw_bangumi" ? rawBangumi : rawAnitabi;
  const statement = statementBuilder()
    .select({ payload: source.payload })
    .from(source)
    .where(eq(source.workId, bangumiId))
    .getSQL();
  return (await db.execute(statement)).rows as { payload: unknown }[];
}

/** UPSERT the `bangumi` row keyed by id (re-enrich overwrites in place). */
function upsertBangumi(row: BangumiRow): SQL {
  return statementBuilder()
    .insert(bangumiTable)
    .values({
      id: row.id, title: row.title, titleCn: row.title_cn, coverUrl: row.cover_url,
      summary: row.summary, rating: row.rating, epsCount: row.eps_count, airDate: row.air_date,
    })
    .onConflictDoUpdate({
      target: bangumiTable.id,
      set: {
        title: row.title, titleCn: row.title_cn, coverUrl: row.cover_url,
        summary: row.summary, rating: row.rating, epsCount: row.eps_count, airDate: row.air_date,
      },
    })
    .getSQL();
}

/** UPSERT all point rows in one statement; an empty point set remains a no-op. */
function upsertPoints(rows: PointRow[]): SQL[] {
  if (rows.length === 0) return [];
  return [statementBuilder()
    .insert(pointsTable)
    .values(rows.map((row) => ({
      id: row.id, bangumiId: row.bangumi_id, name: row.name, nameCn: row.name_cn,
      latitude: row.latitude, longitude: row.longitude, image: row.image,
      episode: row.episode, timeSeconds: row.time_seconds, origin: row.origin, originUrl: row.origin_url,
    })))
    .onConflictDoUpdate({
      target: pointsTable.id,
      set: {
        bangumiId: sql`EXCLUDED.bangumi_id`, name: sql`EXCLUDED.name`, nameCn: sql`EXCLUDED.name_cn`,
        latitude: sql`EXCLUDED.latitude`, longitude: sql`EXCLUDED.longitude`, image: sql`EXCLUDED.image`,
        episode: sql`EXCLUDED.episode`, timeSeconds: sql`EXCLUDED.time_seconds`,
        origin: sql`EXCLUDED.origin`, originUrl: sql`EXCLUDED.origin_url`,
      },
    })
    .getSQL()];
}

/** Compute 50m clusters (no cluster_id column to persist) and log the count. */
function logClusters(bangumiId: string, points: PointRow[]): number {
  const clusters = clusterByLocation(points, 50);
  console.info(`enrich ${bangumiId}: ${String(points.length)} points -> ${String(clusters.length)} clusters`);
  return clusters.length;
}

/** Rank the work's title aliases and UPSERT them in one statement. */
function upsertAliases(bangumiId: string, b: BangumiRow): SQL {
  const aliases = rankAliases(titleAliases(b));
  return statementBuilder()
    .insert(aliasesTable)
    .values(aliases.map((alias) => ({
      bangumiId, alias: alias.alias, aliasNormalized: alias.alias_normalized,
      source: alias.source, priority: alias.priority,
    })))
    .onConflictDoUpdate({
      target: [aliasesTable.bangumiId, aliasesTable.alias, aliasesTable.source],
      set: { aliasNormalized: sql`EXCLUDED.alias_normalized`, priority: sql`EXCLUDED.priority` },
    })
    .getSQL();
}

/** Collect candidate aliases from the bangumi title fields (Bangumi source). */
function titleAliases(b: BangumiRow): RawAlias[] {
  const raw: RawAlias[] = [{ alias: b.title, source: Source.Bangumi }];
  if (b.title_cn) raw.push({ alias: b.title_cn, source: Source.Bangumi });
  return raw;
}
