/**
 * The spike's one door to Postgres, from Node: the shared test server on loopback, and only databases named
 * `spike_pi_durable_*`. The admin database is used for nothing but creating and dropping those, and, at cleanup, for
 * listing their names (`pg-cleanup.ts`, filtered to that prefix in the query). The DSN can be
 * overridden with `SPIKE_PG_ADMIN_DSN` (a re-run on another port); `test` is the repository's fixed test password.
 */
import pg from "pg";

export const ADMIN_DSN = process.env.SPIKE_PG_ADMIN_DSN ?? "postgresql://postgres:test@127.0.0.1:32768/postgres";
/** Where the counting extension lives and where every reset and read runs: never a measured database. */
export const COUNTER_DATABASE = "spike_pi_durable_counter";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

if (!LOOPBACK.has(new URL(ADMIN_DSN).hostname)) throw new Error(`refusing ${new URL(ADMIN_DSN).hostname}: the spike reaches only the loopback test server`);

/** A database name the spike owns, or a throw. */
export function own(name: string): string {
  if (!/^spike_pi_durable_[a-z0-9_]+$/.test(name)) throw new Error(`refusing database ${JSON.stringify(name)}: not one of the spike's own`);
  return name;
}

export function dsnOf(database: string): string {
  const url = new URL(ADMIN_DSN);
  url.pathname = `/${own(database)}`;
  return url.toString();
}

export function portOf(dsn: string = ADMIN_DSN): number {
  return Number(new URL(dsn).port || 5432);
}

export async function withClient<T>(dsn: string, work: (client: pg.Client) => Promise<T>, applicationName = "pi-durable-spike"): Promise<T> {
  const client = new pg.Client({ connectionString: dsn, application_name: applicationName });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * A fresh, empty database of the spike's own (dropped first if a failed run left it), from `template0` as the
 * repository creates its own (`packages/test-postgres/src/clean-database.ts`): this image's background workers can hold
 * `template1` and fail the create (#1890).
 */
export async function createDatabase(name: string): Promise<string> {
  own(name);
  await withClient(ADMIN_DSN, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  }, "pi-durable-spike-admin");
  return dsnOf(name);
}

export async function dropDatabase(name: string): Promise<void> {
  own(name);
  await withClient(ADMIN_DSN, (client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`), "pi-durable-spike-admin");
}
