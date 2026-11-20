import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCleanDatabase, uniqueDatabaseName } from "@animichi/test-postgres";
import pg from "pg";
import { cluster } from "./postgres.ts";

/** The databases the migration ACs apply the chain to, and what those ACs read back from them. */

const migrationRoot = fileURLToPath(new URL("../migrations/app/", import.meta.url));

export const markerQuery = "SELECT core_hash FROM prisma_contract.marker WHERE space = 'app'";

/** Each test migrates its own database created from pristine `template0` — never the
 * fixture's shared-suite database. The server is shared and outlives this run (#1663), so the
 * database this test owns is named per call and dropped by the test that created it. */
export async function cleanTarget(suite: string) {
  const name = uniqueDatabaseName(suite);
  const dsn = await createCleanDatabase(cluster.adminDsn, name);
  const client = new pg.Client({ connectionString: dsn });
  await client.connect();
  return { dsn, client, name };
}

/** The schema identity one checked-in migration leads to, as its manifest records it. */
export async function headOf(migration: string): Promise<string> {
  const manifest = await readFile(join(migrationRoot, migration, "migration.json"), "utf8");
  return (JSON.parse(manifest) as { to: string }).to;
}

/** What the runner answers on: the first column of the step's one row. */
export async function postcheckVerdict(client: pg.Client, sql: string): Promise<boolean> {
  const { rows } = await client.query<{ result: boolean }>(sql);
  return rows[0]?.result === true;
}
