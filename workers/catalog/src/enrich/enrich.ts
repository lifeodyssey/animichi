/**
 * Enrich stage (card W3-2): raw zone -> published catalog.
 *
 * Composes the committed kernels into one work-scoped pass:
 *   1. read raw_bangumi + raw_anitabi for the work (throw if either is absent);
 *   2. UPSERT the `bangumi` row + the `points` rows (ON CONFLICT (id) so a
 *      re-enrich from raw is idempotent — no dup rows);
 *   3. cluster the points (clusterByLocation, 50m). The `points` table has NO
 *      cluster_id column (see remote_schema.sql), so clusters are COMPUTED and
 *      counted here, NOT persisted — route planning re-clusters at query time
 *      (O(n^2)/work). Persisting cluster_id is a deliberate later-wave
 *      decision, not an oversight;
 *   4. build aliases from the bangumi title(s) -> rankAliases -> UPSERT. Only the
 *      Bangumi source is wired here; AniDB/Moegirl/Manual arrive via later ingest.
 *
 * The pass mints no version. Until 2026-11-19 it ended by writing a new
 * `cluster_version` row, a blue/green pointer that nothing read; the write is
 * gone, and the `drop_cluster_version_tables` migration dropped the table.
 *
 * The whole pass runs in ONE transaction, which is what the deleted `db.batch`
 * was for: the work's bangumi row, points and aliases commit together, and a
 * failed enrich leaves none of them written.
 *
 * Statements are builder plans run on the request's runtime ({@link
 * CatalogPrisma}). The UPSERTs add the conflict clause the builder does not model
 * ({@link ../db/plans}); the rows themselves stay builder-built and bound.
 *
 * `points.location` is the column that is WRITTEN, and `latitude` / `longitude`
 * are generated `STORED` columns over it (#1626, spec §4.8.1). The pre-Prisma
 * plane wrote the scalars and let the `sync_points_coordinates` trigger derive
 * the geography; on this plane a scalar write is refused by Postgres
 * (`428C9`), and writing the geometry is the one form correct on both planes.
 * The builder's row type still requires the two coordinates (rc.20), so the row
 * carries the point's own and {@link generatedByTheDatabase} sends DEFAULT for
 * them.
 *
 * KNOWN GAP: enrich only UPSERTs; a point REMOVED upstream is not deleted and
 * lingers in the served catalog (delete-not-in-set is a later-wave fix).
 * LATER / optional (noted, NOT built): city_backfill, series-edge graph, and
 * quality-isolation of low-confidence points.
 */
import { geographyPoint } from "@animichi/prisma-geography";
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../db/prisma";
import { generatedByTheDatabase, upsert } from "../db/plans";
import { clusterByLocation } from "../domain/clustering/cluster";
import { rankAliases, Source, type RawAlias } from "../domain/alias";
import { parseAnitabiPoints, parseBangumi, type BangumiRow, type PointRow } from "./parse";

/** Outcome of enriching one work: how many points it wrote. */
export interface EnrichResult {
  pointCount: number;
}

/** Enrich one work from its raw zone into the catalog, in one transaction. */
export async function enrichWork(query: CatalogPrisma, bangumiId: string): Promise<EnrichResult> {
  const bangumi = parseBangumi(bangumiId, await readRaw(query, "raw_bangumi", bangumiId));
  const points = parseAnitabiPoints(bangumiId, await readRaw(query, "raw_anitabi", bangumiId));
  logClusters(bangumiId, points);
  await query.transaction((tx) => writeWork(tx, bangumiId, bangumi, points));
  return { pointCount: points.length };
}

/** Every write the pass owns, in its mandatory order, inside the caller's transaction. */
async function writeWork(
  query: CatalogPrisma, bangumiId: string, bangumi: BangumiRow, points: PointRow[],
): Promise<void> {
  await query.executor.query(upsertBangumi(query, bangumi));
  if (points.length > 0) await query.executor.query(upsertPoints(query, points));
  await query.executor.query(upsertAliases(query, bangumiId, bangumi));
}

/** Read a raw-zone payload for the work; throw if the row is absent. */
async function readRaw(
  query: CatalogPrisma,
  table: "raw_anitabi" | "raw_bangumi",
  bangumiId: string,
): Promise<unknown> {
  const plan = table === "raw_bangumi" ? rawBangumiPlan(query, bangumiId) : rawAnitabiPlan(query, bangumiId);
  const first = (await query.executor.query(plan))[0];
  if (first === undefined) throw new Error(`No ${table} payload for work ${bangumiId}`);
  return first.payload;
}

/** The work's raw Bangumi subject payload. */
function rawBangumiPlan(query: CatalogPrisma, bangumiId: string): SqlOrmPlan<{ payload: unknown }> {
  return query.builder.public.raw_bangumi
    .select("payload")
    .where((fields, match) => match.eq(fields.work_id, bangumiId))
    .build();
}

/** The work's raw Anitabi points payload. */
function rawAnitabiPlan(query: CatalogPrisma, bangumiId: string): SqlOrmPlan<{ payload: unknown }> {
  return query.builder.public.raw_anitabi
    .select("payload")
    .where((fields, match) => match.eq(fields.work_id, bangumiId))
    .build();
}

/** UPSERT the `bangumi` row keyed by id (re-enrich overwrites in place). */
function upsertBangumi(query: CatalogPrisma, row: BangumiRow): SqlOrmPlan {
  const insert = query.builder.public.bangumi
    .insert([{
      id: row.id, title: row.title, title_cn: row.title_cn, cover_url: row.cover_url,
      summary: row.summary, rating: row.rating, eps_count: row.eps_count, air_date: row.air_date,
    }])
    .build();
  return upsert(insert, {
    target: ["id"],
    update: ["title", "title_cn", "cover_url", "summary", "rating", "eps_count", "air_date"],
  });
}

/** UPSERT every point row in one statement; the caller skips an empty point set. */
function upsertPoints(query: CatalogPrisma, rows: PointRow[]): SqlOrmPlan {
  const insert = query.builder.public.points
    .insert(rows.map(pointValues))
    .returning("id")
    .build();
  return upsert(generatedByTheDatabase(insert, "points"), { target: ["id"], update: POINT_UPDATE_COLUMNS });
}

/** The columns a re-enrich overwrites on an existing point. */
const POINT_UPDATE_COLUMNS = [
  "bangumi_id", "name", "name_cn", "location", "image", "episode", "time_seconds", "origin", "origin_url",
] as const;

/**
 * A point row as the plane stores it: the coordinates become the geography
 * `location`. `latitude` / `longitude` are generated over it, so they carry the
 * same coordinates only for the builder's row check and are sent as DEFAULT.
 */
function pointValues(row: PointRow) {
  return {
    id: row.id, bangumi_id: row.bangumi_id, name: row.name, name_cn: row.name_cn,
    location: geographyPoint(row.longitude, row.latitude), latitude: row.latitude, longitude: row.longitude,
    image: row.image, episode: row.episode, time_seconds: row.time_seconds, origin: row.origin, origin_url: row.origin_url,
  };
}

/** Compute 50m clusters (no cluster_id column to persist) and log the count. */
function logClusters(bangumiId: string, points: PointRow[]): number {
  const clusters = clusterByLocation(points, 50);
  console.info(`enrich ${bangumiId}: ${String(points.length)} points -> ${String(clusters.length)} clusters`);
  return clusters.length;
}

/** Rank the work's title aliases and UPSERT them in one statement. */
function upsertAliases(query: CatalogPrisma, bangumiId: string, b: BangumiRow): SqlOrmPlan {
  const aliases = rankAliases(titleAliases(b));
  const insert = query.builder.public.aliases
    .insert(aliases.map((alias) => ({
      bangumi_id: bangumiId, alias: alias.alias, alias_normalized: alias.alias_normalized,
      source: alias.source, priority: alias.priority,
    })))
    .build();
  return upsert(insert, {
    target: ["bangumi_id", "alias", "source"],
    update: ["alias_normalized", "priority"],
  });
}

/** Collect candidate aliases from the bangumi title fields (Bangumi source). */
function titleAliases(b: BangumiRow): RawAlias[] {
  const raw: RawAlias[] = [{ alias: b.title, source: Source.Bangumi }];
  if (b.title_cn) raw.push({ alias: b.title_cn, source: Source.Bangumi });
  return raw;
}
