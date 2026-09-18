import assert from "node:assert/strict";
import { test } from "node:test";
import { uniqueDatabaseName } from "@animichi/test-postgres";
import type pg from "pg";
import { DATA_PLANE_ACCESS } from "../migrations/app/20260913T1711_data_plane_baseline/access.ts";
import { contractClient } from "./contract-client.ts";
import { contractDsn, database, pool, SESSION_ID } from "./postgres.ts";

type PostcheckStep = (typeof DATA_PLANE_ACCESS.postcheck)[number];

const MUTABLE_TABLES = ["pi_sessions", "pi_scalar_values", "pi_list_values", "agent_admissions", "agent_open_operations", "agent_settlements"] as const;
const MUTABLE_TABLE_LIST = MUTABLE_TABLES.join(", ");

/** Reproduce Neon's role layering for the length of one transaction: the
 * predefined blanket roles put SELECT, INSERT, UPDATE and DELETE in `grantee`'s
 * effective privileges without one ACL row of its own. Role and membership DDL
 * is cluster-global and the container is shared (#1663), so it never commits — a
 * committed `pg_write_all_data` membership would disarm every arm's 42501
 * assertions at once. */
async function beginNeonLayer(client: pg.PoolClient, grantee: string): Promise<void> {
  const layer = uniqueDatabaseName("neon_layer");
  await client.query("BEGIN");
  await client.query(`CREATE ROLE "${layer}" NOLOGIN`);
  await client.query(`GRANT pg_read_all_data, pg_write_all_data TO "${layer}"`);
  await client.query(`GRANT "${layer}" TO ${grantee}`);
}

async function rollbackAndRelease(client: pg.PoolClient): Promise<void> {
  await client.query("ROLLBACK");
  client.release();
}

async function booleanValue(client: pg.PoolClient, sql: string): Promise<boolean> {
  const result = await client.query<{ result: unknown }>(sql);
  return result.rows[0]?.result === true;
}

async function explicitGrants(client: pg.PoolClient, grantee: string, table: string): Promise<string[]> {
  const result = await client.query<{ privilege_type: string }>("SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = $1 AND table_schema = 'public' AND table_name = $2 ORDER BY privilege_type", [grantee, table]);
  return result.rows.map((row) => row.privilege_type);
}

/** The one postcheck step that speaks for `grantee` on `table`, by the failure
 * text it carries. The role is half the search: the baseline grants one table to
 * as many as four roles, so a table name alone would hand back another role's
 * verdict. */
function stepFor(grantee: string, table: string): PostcheckStep {
  const step = DATA_PLANE_ACCESS.postcheck.find(({ description }) => description.includes(`${grantee}'s explicit grants on ${table} are`));
  assert.ok(step, `no postcheck step names ${grantee}'s grants on ${table}`);
  return step;
}

/** What the migration runner answers on: the first step whose first value is
 * not true, whose description is the text the failure envelope carries. */
async function firstFailingStep(client: pg.PoolClient, steps: readonly PostcheckStep[]): Promise<PostcheckStep | undefined> {
  for (const step of steps) if (!(await booleanValue(client, step.sql))) return step;
  return undefined;
}

void test("only the agent service can access native agent tables", async () => {
  const roles = await pool.query("SELECT role, count(*) FILTER (WHERE has_table_privilege(role, name, 'SELECT'))::int AS readable_tables, count(*)::int AS tables FROM unnest(ARRAY['agent_svc','catalog_svc','users_svc','jobs_svc','readonly']) AS role CROSS JOIN unnest(ARRAY['pi_sessions','pi_records','pi_scalar_values','pi_list_values','agent_admissions','agent_open_operations','agent_settlements']) AS name GROUP BY role ORDER BY role");
  assert.deepEqual(roles.rows, [{ role: "agent_svc", readable_tables: 7, tables: 7 }, { role: "catalog_svc", readable_tables: 0, tables: 7 }, { role: "jobs_svc", readable_tables: 0, tables: 7 }, { role: "readonly", readable_tables: 0, tables: 7 }, { role: "users_svc", readable_tables: 0, tables: 7 }]);
});

void test("the agent role can append native records but cannot edit or directly delete history", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN; SET LOCAL ROLE agent_svc");
    await client.query("INSERT INTO pi_records (session_id,id,seq,kind,payload) VALUES ($1,'entry',0,'entry','{\"id\":\"entry\",\"seq\":0}')", [SESSION_ID]);
    await client.query("COMMIT");
    await client.query("BEGIN; SET LOCAL ROLE agent_svc");
    await assert.rejects(client.query("UPDATE pi_records SET seq = 9"), { code: "42501" });
    await client.query("ROLLBACK; BEGIN; SET LOCAL ROLE agent_svc");
    await assert.rejects(client.query("DELETE FROM pi_records"), { code: "42501" });
  } finally { await client.query("ROLLBACK"); client.release(); }
  assert.deepEqual(await database.orm.public.PiRecord.select("id", "seq").all(), [{ id: "entry", seq: 0 }]);
});

void test("the agent service uses the native Prisma runtime with its own database privileges", async () => {
  const url = new URL(contractDsn);
  url.searchParams.set("options", "-c role=agent_svc");
  await using agent = contractClient(url.href);
  await agent.orm.public.PiScalarValue.create({ sessionId: SESSION_ID, namespace: "app", key: "city", seq: 0, value: { city: "Kyoto" } });
  assert.deepEqual(await agent.orm.public.PiScalarValue.select("value").all(), [{ value: { city: "Kyoto" } }]);
});

void test("the append-only postcheck passes on a database whose agent role is neon_superuser-shaped", async () => {
  const client = await pool.connect();
  try {
    await beginNeonLayer(client, "agent_svc");
    assert.deepEqual(await explicitGrants(client, "agent_svc", "pi_records"), ["INSERT", "SELECT"]);
    assert.equal(await booleanValue(client, "SELECT has_table_privilege('agent_svc', 'pi_records', 'UPDATE') AS result"), true);
    assert.equal(await booleanValue(client, "SELECT has_table_privilege('agent_svc', 'pi_records', 'DELETE') AS result"), true);
    assert.equal(await firstFailingStep(client, DATA_PLANE_ACCESS.postcheck), undefined);
  } finally { await rollbackAndRelease(client); }
});

void test("an explicit UPDATE or DELETE grant on pi_records turns the postcheck red, and revoking it turns it green", async () => {
  const client = await pool.connect();
  try {
    await beginNeonLayer(client, "agent_svc");
    assert.equal(await firstFailingStep(client, DATA_PLANE_ACCESS.postcheck), undefined);
    await client.query("GRANT UPDATE, DELETE ON pi_records TO agent_svc");
    assert.deepEqual(await explicitGrants(client, "agent_svc", "pi_records"), ["DELETE", "INSERT", "SELECT", "UPDATE"]);
    const violating = await firstFailingStep(client, DATA_PLANE_ACCESS.postcheck);
    assert.match(violating?.description ?? "", /pi_records are exactly INSERT, SELECT \(no UPDATE or DELETE grants\)/u);
    await client.query("REVOKE UPDATE, DELETE ON pi_records FROM agent_svc");
    assert.equal(await firstFailingStep(client, DATA_PLANE_ACCESS.postcheck), undefined);
  } finally { await rollbackAndRelease(client); }
});

void test("the neon_superuser layer alone cannot satisfy the postcheck", async () => {
  const client = await pool.connect();
  try {
    await beginNeonLayer(client, "agent_svc");
    await client.query(`REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE ${MUTABLE_TABLE_LIST} FROM agent_svc`);
    assert.deepEqual(await explicitGrants(client, "agent_svc", "pi_sessions"), []);
    assert.equal(await booleanValue(client, "SELECT has_table_privilege('agent_svc', 'pi_sessions', 'UPDATE') AS result"), true);
    for (const table of MUTABLE_TABLES) assert.equal(await booleanValue(client, stepFor("agent_svc", table).sql), false, table);
  } finally { await rollbackAndRelease(client); }
});

void test("the neon_superuser layer alone cannot satisfy the postcheck for a catalog grant either", async () => {
  const client = await pool.connect();
  try {
    await beginNeonLayer(client, "catalog_svc");
    await client.query("REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.aliases FROM catalog_svc");
    assert.deepEqual(await explicitGrants(client, "catalog_svc", "aliases"), []);
    assert.equal(await booleanValue(client, "SELECT has_table_privilege('catalog_svc', 'aliases', 'UPDATE') AS result"), true);
    const violating = await firstFailingStep(client, DATA_PLANE_ACCESS.postcheck);
    assert.match(violating?.description ?? "", /verify catalog_svc's explicit grants on aliases are exactly DELETE, INSERT, SELECT, UPDATE/u);
    await client.query("GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE public.aliases TO catalog_svc");
    assert.equal(await firstFailingStep(client, DATA_PLANE_ACCESS.postcheck), undefined);
  } finally { await rollbackAndRelease(client); }
});
