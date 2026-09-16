/**
 * The two things a fresh database now gets besides schema (#1625): the chain
 * that builds it, and the five service roles that own access to it.
 *
 * AC1 — the database a call hands back was built by the committed Prisma chain.
 * The proof is the chain's own identity (`prisma_contract.marker` names the
 * contract head) plus the deletion: the Atlas ledger table does not exist, and
 * the whole path runs with `ATLAS_BIN` naming a file that is not there, so a
 * regression that shells out to the old binary cannot pass by finding it.
 *
 * AC2 — all five roles exist in that database, and the chain's grant matrix ran
 * against them. The assertions that already read them are
 * `packages/pi-session-neon/test/acl.db.test.ts` (five roles x seven tables) and
 * `runtime-acl.db.test.ts` (`current_user = agent_svc`); they are unchanged, and
 * the fixture owning the roles is what lets them stay that way.
 *
 * AC3 — the failure mode of a missing role. Creation and assertion are separate
 * steps in `test-postgres.ts`, so deleting the creation makes the assertion
 * name the roles it did not find instead of leaving the chain to report a false
 * precheck (`data-plane-access`) three statements later.
 *
 * test-type: integration (boots or reuses the offline image, creates a database,
 * applies the chain, opens real sessions).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import pg from "pg";
import { assertServiceRoles, SERVICE_ROLES, SPIKE_SETUP_BUDGET, startTestPostgres, type TestPostgres } from "../../src/index.ts";

const contractHead = (JSON.parse(
  readFileSync(new URL("../../../pi-session-neon/src/contract.json", import.meta.url), "utf8"),
) as { storage: { storageHash: string } }).storage.storageHash;

/** The object set the chain owns is wide; these are one witness per family —
 * catalog, users, native agent — so a chain that applied only part of itself is
 * not read as applied. */
const CHAIN_OBJECTS = ["points", "saved_routes", "pi_sessions", "agent_admissions"] as const;
const CHAIN_EXTENSIONS = ["postgis", "pgcrypto", "pg_trgm", "vector"] as const;
const ABSENT_ROLE = "no_such_role_1625";

let plane: TestPostgres;
const resources: { plane?: TestPostgres } = {};

/** One statement, on a session this file owns. */
async function queryRows<Row extends pg.QueryResultRow>(dsn: string, statement: string, values: unknown[] = []): Promise<Row[]> {
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    return (await client.query<Row>(statement, values)).rows;
  } finally {
    await client.end();
  }
}

/** Object presence for `CHAIN_OBJECTS`: `to_regclass` answers null, not an
 * error, so one statement proves both the present and the absent set. */
function objectQuery(names: readonly string[]): string {
  return names.map((name) => `to_regclass('public.${name}') IS NOT NULL AS ${name}`).join(", ");
}

const EXTENSION_QUERY = `SELECT count(*)::int AS present FROM pg_extension WHERE extname = ANY($1::text[])`;

before(async () => {
  // The falsifier for "no Atlas invocation anywhere in the path": the binary's
  // override points somewhere that cannot be executed. A fixture that still
  // consulted it would fail here, and this one passes.
  const previous = process.env.ATLAS_BIN;
  process.env.ATLAS_BIN = "/nonexistent/atlas-1625";
  try {
    plane = resources.plane = await startTestPostgres({ database: "fresh_chain_witness", budget: SPIKE_SETUP_BUDGET });
  } finally {
    if (previous === undefined) delete process.env.ATLAS_BIN;
    else process.env.ATLAS_BIN = previous;
  }
});

after(async () => {
  await resources.plane?.stop();
});

void test("the chain's marker names the checkout head, and the Atlas ledger is gone (AC1)", async () => {
  assert.deepEqual(await queryRows(plane.dsn, "SELECT core_hash FROM prisma_contract.marker WHERE space = 'app'"),
    [{ core_hash: contractHead }]);
  assert.deepEqual(await queryRows(plane.dsn, `SELECT to_regclass('public.atlas_schema_revisions') IS NULL AS absent`),
    [{ absent: true }]);
});

void test("the applied chain carries every family of object, extensions included (AC1)", async () => {
  assert.deepEqual(await queryRows(plane.dsn, `SELECT ${objectQuery(CHAIN_OBJECTS)}`),
    [{ points: true, saved_routes: true, pi_sessions: true, agent_admissions: true }]);
  assert.deepEqual(await queryRows(plane.dsn, EXTENSION_QUERY, [CHAIN_EXTENSIONS]),
    [{ present: CHAIN_EXTENSIONS.length }]);
});

void test("all five service roles exist, and the chain granted them schema usage (AC2)", async () => {
  const roles = await queryRows<{ rolname: string; rolcanlogin: boolean }>(
    plane.dsn, "SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname", [SERVICE_ROLES]);
  assert.deepEqual(roles, [...SERVICE_ROLES].sort().map((rolname) => ({ rolname, rolcanlogin: false })));
  const granted = await queryRows<{ granted: number }>(plane.dsn,
    `SELECT count(*)::int AS granted FROM unnest($1::text[]) AS role
     WHERE has_schema_privilege(role, 'public', 'USAGE')`, [SERVICE_ROLES]);
  assert.deepEqual(granted, [{ granted: SERVICE_ROLES.length }]);
});

void test("an absent role is reported by name and nothing else (AC3)", async () => {
  await assertServiceRoles(plane.dsn);
  const candidate = [...SERVICE_ROLES, ABSENT_ROLE];
  await assert.rejects(assertServiceRoles(plane.dsn, candidate), {
    message: `missing PostgreSQL service roles: ${ABSENT_ROLE}`,
  });
});
