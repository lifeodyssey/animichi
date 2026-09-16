/**
 * The shared container's three contracts (#1663), against a real Docker daemon.
 *
 * The chain witness — three calls started AT ONCE, and the reason the cluster's
 * role block is serialized on this cluster — comes first, and has to stay first:
 * it is exercised against a `pg_roles` that no call of this run has filled yet,
 * which is the state of a container a first run meets. On a container whose
 * roles already exist nothing can race, because every later call's creation
 * skips the block it holds the turn for.
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
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { clusterAdminDsn, SPIKE_SETUP_BUDGET, startTestPostgres, type TestPostgres } from "../../src/index.ts";

const FIRST_SUITE = "shared_plane_first";
const SECOND_SUITE = "shared_plane_second";
const CONCURRENT_SUITE = "shared_plane_concurrent";
/** Every caller applies the whole chain, so any two of them that overlap are the
 * race; three bodies make that overlap the common case, not a coincidence. */
const CONCURRENT_CALLS = 3;

/** The chain's own identity: one marker row, naming the head the checkout is on.
 * The migrations are the source of truth for "the full chain", not a number
 * written here — the head comes from the contract the chain was emitted for. */
function chainHead(): string {
  const contract = JSON.parse(
    readFileSync(new URL("../../../../packages/pi-session-neon/src/contract.json", import.meta.url), "utf8"),
  ) as { storage: { storageHash: string } };
  return contract.storage.storageHash;
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

/** The chain's own bookkeeping: one row per applied space, at the head. */
async function appliedMarker(dsn: string): Promise<string | null> {
  const [row] = await queryRows<{ core_hash: string }>(dsn, "select core_hash from prisma_contract.marker where space = 'app'");
  return row?.core_hash ?? null;
}

async function assertOneServerTwoMigratedDatabases(first: TestPostgres, second: TestPostgres): Promise<void> {
  assert.deepEqual(await clusterIdentity(first.dsn), await clusterIdentity(second.dsn));
  assert.notEqual(new URL(first.dsn).pathname, new URL(second.dsn).pathname);
  await assertFullChain(first.dsn);
  await assertFullChain(second.dsn);
}

async function assertOnlyOwnDatabaseDropped(first: TestPostgres, second: TestPostgres): Promise<void> {
  await assert.rejects(queryRows(first.dsn, "select 1"), { code: "3D000" });
  assert.deepEqual(await queryRows(second.dsn, "select 1 as one"), [{ one: 1 }]);
  assert.deepEqual(await queryRows(clusterAdminDsn(second.dsn), "select 1 as one"), [{ one: 1 }]);
}

/** One arm's budget is enough: this call boots (or reuses) the server itself. */
function request(suite: string) {
  return { database: suite, budget: SPIKE_SETUP_BUDGET };
}

/** Every caller starts at once. Each plane is recorded the moment it lands, so a
 * start that fails cannot strand the ones that succeeded. */
async function startAllAtOnce(landed: TestPostgres[]): Promise<void> {
  const requests = Array.from({ length: CONCURRENT_CALLS }, () => request(CONCURRENT_SUITE));
  await Promise.all(requests.map(async (each) => {
    landed.push(await startTestPostgres(each));
  }));
}

/** The whole chain on the database this call owns: the marker names the head the
 * committed migrations end at. */
async function assertFullChain(dsn: string): Promise<void> {
  assert.equal(await appliedMarker(dsn), chainHead());
}

/** The role block is cluster-global and not atomic — it reads `pg_roles` and then
 * creates — so two callers that reach it together both read an empty catalog and
 * the second one to commit dies on `pg_authid_rolname_index`. That is exactly
 * how CI's edge lane failed once every caller shared one container, and it is
 * why both steps hold one cluster turn (#1663). */
void test("three calls started at once each land a fully migrated database (#1663)", async () => {
  const landed: TestPostgres[] = [];
  try {
    await startAllAtOnce(landed);
    await Promise.all(landed.map((plane) => assertFullChain(plane.dsn)));
  } finally {
    await Promise.allSettled(landed.map((plane) => plane.stop()));
  }
});

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
