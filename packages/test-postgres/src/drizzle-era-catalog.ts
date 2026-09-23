/** The catalog schema `workers/catalog`'s RETIRED Drizzle query layer read and wrote.
 *
 * A TEST FIXTURE, not a migration authority: one frozen SQL file, no checksum, no revision
 * ledger, no CLI, and no path to a shared or live database. The query layer it records is gone
 * (#1628–#1633); this module is LIVE, and its consumers are two named files rather than an era:
 * `packages/agent/integration-test/catalog-postgres.ts` calls `applyDrizzleEraCatalog` on a
 * database of its own, and `workers/catalog/test/geocode-migration-parity.node.test.ts`
 * reads the SQL as text to pin the table shapes its geocode seed relies on.
 *
 * They need it because the agent lane's own `catalog-seed.ts` writes `points.latitude` /
 * `longitude` as plain scalars and the fixture carries `points.embedding`: on the Prisma-migrated
 * plane those coordinates are GENERATED and `embedding` is absent, so that seed cannot run there
 * (one chain per database). The catalog integration suite stopped building this shape with #1633.
 * Both files go when neither consumer needs the pre-Prisma shape any more.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "sql", "drizzle-era-catalog.sql");

/** Install the frozen shape on `dsn` in ONE transaction: a half-installed fixture would fail the
 * suite that reads it with a missing-relation error instead of with this file's own failure. */
export async function applyDrizzleEraCatalog(dsn: string): Promise<void> {
  const sql = await readFile(FIXTURE, "utf8");
  const client = new pg.Client({ connectionString: dsn });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (failure) {
    await client.query("ROLLBACK");
    throw failure;
  } finally {
    await client.end();
  }
}
