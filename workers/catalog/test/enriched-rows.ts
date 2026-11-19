import pg from "pg";

/**
 * The catalog rows one work's enrich writes, as a suite reads them back over
 * its pool: the `bangumi` row, the `points` and the `aliases`, every column
 * except the timestamps and the aliases' generated `id`. `location` is read as
 * WKT and every list is in byte order (`COLLATE "C"`), so a comparison depends
 * on neither the geography codec nor the database's collation.
 */
export interface EnrichedRows {
  readonly bangumi: readonly Record<string, unknown>[];
  readonly points: readonly Record<string, unknown>[];
  readonly aliases: readonly Record<string, unknown>[];
}

const BANGUMI_SQL = "SELECT id, title, title_cn, cover_url, summary, rating, eps_count, air_date,"
  + " points_count, city, platform, primary_color FROM bangumi WHERE id = $1";
const POINTS_SQL = "SELECT id, bangumi_id, name, name_cn, latitude, longitude, ST_AsText(location) AS location,"
  + " image, episode, time_seconds, origin, origin_url, city, scene_desc"
  + ` FROM points WHERE bangumi_id = $1 ORDER BY id COLLATE "C"`;
const ALIASES_SQL = "SELECT bangumi_id, alias, alias_normalized, source, priority"
  + ` FROM aliases WHERE bangumi_id = $1 ORDER BY alias COLLATE "C"`;

/** Read back the {@link EnrichedRows} of one work. */
export async function enrichedRows(pool: pg.Pool, workId: string): Promise<EnrichedRows> {
  const read = async (sql: string) => (await pool.query<Record<string, unknown>>(sql, [workId])).rows;
  return { bangumi: await read(BANGUMI_SQL), points: await read(POINTS_SQL), aliases: await read(ALIASES_SQL) };
}
