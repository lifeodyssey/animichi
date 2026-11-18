/**
 * The statement counter: `pg_stat_monitor` 2.4 on the test server (`../evidence/q2-pg-inspect.json`: preloaded,
 * `pgsm_track = top`, `pgsm_track_utility = on`, ten buckets of 60 s). The reset and every read run from the spike's
 * counter database, never a measured one, so they stay out of every count. The reset is global: one count at a time,
 * and a measured run must end within the ten buckets (about ten minutes) after its reset.
 */
import { ADMIN_DSN, COUNTER_DATABASE, dsnOf, withClient } from "./pg-admin.ts";

export interface CountedRow {
  readonly database: string;
  readonly query: string;
  readonly cmd: string | null;
  readonly relations: string | null;
  readonly calls: number;
  readonly elevel: number;
  readonly sqlcode: string | null;
  readonly application: string | null;
}

export interface Count { readonly databases: string[]; readonly total: number; readonly rows: CountedRow[] }

const COUNTER = "pi-durable-spike-counter";
let ensured = false;

/** The counter database and its extension, created only when missing: never dropped while a count may need it. */
async function ensureCounter(): Promise<void> {
  if (ensured) return;
  try {
    await withClient(dsnOf(COUNTER_DATABASE), (client) => client.query("CREATE EXTENSION IF NOT EXISTS pg_stat_monitor"), COUNTER);
  } catch (error) {
    if ((error as { code?: string }).code !== "3D000") throw error;
    await withClient(ADMIN_DSN, (client) => client.query(`CREATE DATABASE "${COUNTER_DATABASE}" TEMPLATE template0`), "pi-durable-spike-admin");
    await withClient(dsnOf(COUNTER_DATABASE), (client) => client.query("CREATE EXTENSION IF NOT EXISTS pg_stat_monitor"), COUNTER);
  }
  ensured = true;
}

export async function resetCounter(): Promise<void> {
  await ensureCounter();
  await withClient(dsnOf(COUNTER_DATABASE), (client) => client.query("SELECT pg_stat_monitor_reset()"), COUNTER);
}

/** Every statement counted since the reset in the databases whose name matches the SQL `LIKE` pattern, summed over buckets. */
export async function readCount(databaseLike: string): Promise<Count> {
  const { rows } = await withClient(dsnOf(COUNTER_DATABASE), (client) => client.query<{ datname: string; query: string; cmd_type_text: string | null;
    relations: string | null; calls: string; elevel: number; sqlcode: string | null; application_name: string | null }>(`SELECT datname, query, cmd_type_text,
      array_to_string(relations, ',') AS relations, sum(calls) AS calls, elevel, sqlcode, application_name FROM pg_stat_monitor WHERE datname LIKE $1
      GROUP BY datname, query, cmd_type_text, relations, elevel, sqlcode, application_name ORDER BY datname, min(bucket_start_time), query`, [databaseLike]), COUNTER);
  const counted = rows.map((row) => ({ database: row.datname, query: row.query, cmd: row.cmd_type_text, relations: row.relations, calls: Number(row.calls),
    elevel: row.elevel, sqlcode: row.sqlcode, application: row.application_name }));
  return { databases: [...new Set(counted.map((row) => row.database))], total: counted.reduce((sum, row) => sum + row.calls, 0), rows: counted };
}

/** A count's statements, split by a predicate over the query text: the ones it names, and the rest. */
export function split(count: Count, excluded: (row: CountedRow) => boolean) {
  const out = count.rows.filter(excluded);
  const kept = count.rows.filter((row) => !excluded(row));
  return { kept: kept.reduce((sum, row) => sum + row.calls, 0), excluded: out.reduce((sum, row) => sum + row.calls, 0), excludedRows: out, keptRows: kept };
}
