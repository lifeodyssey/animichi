/** The catalog schema `workers/catalog`'s Drizzle query layer still reads and writes.
 *
 * A TEST FIXTURE, not a migration authority: one frozen SQL file, no checksum, no revision
 * ledger, no CLI, and no path to a shared or live database. Two integration lanes — the catalog
 * suite and the agent's native catalog tools — write `points.latitude` / `longitude` as plain
 * scalars and read `points.embedding`, both of which the Prisma data plane makes generated or
 * omits. Until #1629–#1631 move that query layer, those lanes build a database of their own from
 * this file instead of reading the Prisma-migrated plane (one chain per database).
 *
 * `sql/drizzle-era-catalog.sql` and this module are deleted together with that branch.
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
