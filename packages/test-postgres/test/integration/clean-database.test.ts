/**
 * Which template the clean database is created from, against a real server (#1890).
 *
 * `CREATE DATABASE … TEMPLATE x` refuses while any other session is attached to
 * `x` — after the server has already spent 5 s waiting for that session to
 * leave (`CountOtherDBBackends`, 50 tries × 100 ms). `template1` is connectable,
 * so this image's preloaded background workers reach it; on the
 * shared container that is 2 sessions and 104 ms of session time in fourteen
 * hours, which is both why the refusal reached `main` twice and why no sampler
 * of ours ever caught the holder. `template0` is the template PostgreSQL keeps
 * unconnectable for exactly this reason, and the one `pg_dump --create` emits.
 *
 * Two claims, one test each: a session on `template1` no longer refuses the
 * create, and what the create produces is still the pristine schema the chain's
 * clean-apply check needs — a database created from each of the two compares
 * identical here, so "unconnectable" costs nothing.
 *
 * test-type: integration (boots or reuses the offline image, opens real sessions).
 */
import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { createCleanDatabase, dropCleanDatabase } from "../../src/clean-database.ts";
import { SPIKE_SETUP_BUDGET, startTestPostgresCluster, uniqueDatabaseName } from "../../src/index.ts";

const EXTENSIONS = "SELECT extname AS value FROM pg_extension ORDER BY 1";
const SCHEMAS = `SELECT nspname AS value FROM pg_namespace
  WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' ORDER BY 1`;
const RELATIONS = `SELECT n.nspname || '.' || c.relname AS value FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') ORDER BY 1`;
const CURRENT_DATABASE = "SELECT current_database() AS value";

/** What a database carries beyond the catalogs. */
interface DatabaseContents {
  readonly extensions: readonly string[];
  readonly schemas: readonly string[];
  readonly relations: readonly string[];
}

/** initdb's own leavings, and nothing else — what a clean database must be. */
const PRISTINE: DatabaseContents = { extensions: ["plpgsql"], schemas: ["public"], relations: [] };

/** The same server, with `template1` as its database: a session on the template itself. */
function template1Dsn(adminDsn: string): string {
  return `${adminDsn.split("/").slice(0, 3).join("/")}/template1?sslmode=disable`;
}

/** An open session, for the caller to close. */
async function openSession(dsn: string): Promise<pg.Client> {
  const client = new pg.Client(dsn);
  await client.connect();
  return client;
}

/** Every value the query's `value` column returns, on a session of this test's own. */
async function valuesOn(dsn: string, sql: string): Promise<string[]> {
  const client = await openSession(dsn);
  try {
    const { rows } = await client.query<{ value: string }>(sql);
    return rows.map((row) => row.value);
  } finally {
    await client.end();
  }
}

async function contentsOf(dsn: string): Promise<DatabaseContents> {
  return {
    extensions: await valuesOn(dsn, EXTENSIONS),
    schemas: await valuesOn(dsn, SCHEMAS),
    relations: await valuesOn(dsn, RELATIONS),
  };
}

void test("a session held on template1 does not refuse the clean create", async () => {
  const cluster = await startTestPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  const name = uniqueDatabaseName("held_template1");
  const holder = await openSession(template1Dsn(cluster.adminDsn));
  try {
    const dsn = await createCleanDatabase(cluster.adminDsn, name);
    assert.deepEqual(await valuesOn(dsn, CURRENT_DATABASE), [name]);
  } finally {
    await holder.end();
    await dropCleanDatabase(cluster.adminDsn, name);
  }
});

void test("the clean database carries initdb's schema and nothing the image added", async () => {
  const cluster = await startTestPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  const name = uniqueDatabaseName("pristine_clean");
  const dsn = await createCleanDatabase(cluster.adminDsn, name);
  try {
    assert.deepEqual(await contentsOf(dsn), PRISTINE);
  } finally {
    await dropCleanDatabase(cluster.adminDsn, name);
  }
});
