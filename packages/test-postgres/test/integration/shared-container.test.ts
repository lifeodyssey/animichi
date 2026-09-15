/**
 * The shared container's two contracts (#1663), against a real Docker daemon.
 *
 * AC1 — two `startTestPostgres` calls with the SAME suite name land on ONE
 * server, in two distinct databases, each with the committed chain applied.
 * AC2 — `stop()` drops only its own database: the other database and the server
 * keep accepting sessions. The per-call naming rule itself is the unit witness
 * in `test/database-name.test.ts` (AC3); AC1 reaches it through the real entry
 * point, where the two names must still differ.
 *
 * test-type: integration (boots or reuses the offline image, applies the chain,
 * opens real sessions). It is `test:integration`, never `test`: the package's
 * `test` stays Docker-free so a pre-commit or pre-push run of it never waits on
 * a daemon.
 */
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { SPIKE_SETUP_BUDGET, startTestPostgres, type TestPostgres } from "../../src/index.ts";

const FIRST_SUITE = "shared_plane_first";
const SECOND_SUITE = "shared_plane_second";

/** The chain's length, read from the committed directory: the migrations are
 * the source of truth for "the full chain", not a number written here. */
function chainLength(): number {
  const directory = new URL("../../../../migrations/neon/", import.meta.url);
  return readdirSync(directory).filter((file) => file.endsWith(".sql")).length;
}

/** One statement, on a session this file owns. */
async function queryRows<Row extends pg.QueryResultRow>(dsn: string, statement: string): Promise<Row[]> {
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    return (await client.query<Row>(statement)).rows;
  } finally {
    await client.end();
  }
}

/** What tells one server from another: the cluster's own identity, plus the
 * host port this call's DSN reaches it on. Two containers cannot share both. */
async function clusterIdentity(dsn: string): Promise<{ system: string; port: string }> {
  const [row] = await queryRows<{ system_identifier: string }>(dsn, "select system_identifier::text from pg_control_system()");
  assert.ok(row);
  return { system: row.system_identifier, port: new URL(dsn).port };
}

/** The chain's own bookkeeping: one row per applied revision. */
async function appliedRevisions(dsn: string): Promise<number> {
  const [row] = await queryRows<{ applied: number }>(dsn, "select count(*)::int as applied from public.atlas_schema_revisions");
  assert.ok(row);
  return row.applied;
}

/** The admin database, derived from a call's DSN — a second session target that
 * proves the SERVER is alive rather than the database. */
function adminDsn(planeDsn: string): string {
  const url = new URL(planeDsn);
  url.pathname = "/postgres";
  return url.toString();
}

async function assertOneServerTwoMigratedDatabases(first: TestPostgres, second: TestPostgres): Promise<void> {
  assert.deepEqual(await clusterIdentity(first.dsn), await clusterIdentity(second.dsn));
  assert.notEqual(new URL(first.dsn).pathname, new URL(second.dsn).pathname);
  assert.equal(await appliedRevisions(first.dsn), chainLength());
  assert.equal(await appliedRevisions(second.dsn), chainLength());
}

async function assertOnlyOwnDatabaseDropped(first: TestPostgres, second: TestPostgres): Promise<void> {
  await assert.rejects(queryRows(first.dsn, "select 1"), { code: "3D000" });
  assert.deepEqual(await queryRows(second.dsn, "select 1 as one"), [{ one: 1 }]);
  assert.deepEqual(await queryRows(adminDsn(second.dsn), "select 1 as one"), [{ one: 1 }]);
}

/** One arm's budget is enough: this call boots (or reuses) the server itself. */
function request(suite: string) {
  return { database: suite, budget: SPIKE_SETUP_BUDGET };
}

void test("two calls with one suite name share the container, each in its own migrated database (AC1)", async () => {
  const first = await startTestPostgres(request(FIRST_SUITE));
  const second = await startTestPostgres(request(FIRST_SUITE));
  try {
    await assertOneServerTwoMigratedDatabases(first, second);
  } finally {
    await Promise.all([first.stop(), second.stop()]);
  }
});

void test("stop() drops only its own database; the other one and the server live on (AC2)", async () => {
  const first = await startTestPostgres(request(FIRST_SUITE));
  const second = await startTestPostgres(request(SECOND_SUITE));
  try {
    await first.stop();
    await assertOnlyOwnDatabaseDropped(first, second);
  } finally {
    await second.stop();
  }
});
