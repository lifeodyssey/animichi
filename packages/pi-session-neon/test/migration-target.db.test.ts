import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createCleanDatabase, dropCleanDatabase, uniqueDatabaseName } from "@animichi/test-postgres";
import pg from "pg";
import { DATA_PLANE_ACCESS } from "../migrations/app/20260913T1711_data_plane_baseline/access.ts";
import contractJson from "../src/contract.json" with { type: "json" };
import { droppedCatalogGrant, futureContract, tamperedContract } from "./migration-fixtures.ts";
import { migrate, packageRoot, prisma, prismaCliOutput } from "./prisma-migration.ts";
import { cluster } from "./postgres.ts";

const migrationRoot = fileURLToPath(new URL("../migrations/app/", import.meta.url));
const markerQuery = "SELECT core_hash FROM prisma_contract.marker WHERE space = 'app'";
const EXACT_SET_STEP = "information_schema.role_table_grants";

/** Every exact-set grant step, each one coupled to the role and the table its failure text
 * names. The closing step reads schema and sequence privileges instead, so it is not one. */
const grantSteps = DATA_PLANE_ACCESS.postcheck.filter(({ sql }) => sql.includes(EXACT_SET_STEP));

/** Each test migrates its own database created from pristine `template1` — never the
 * fixture's shared-suite database. The server is shared and outlives this run (#1663), so the
 * database this test owns is named per call and dropped by the test that created it. */
async function cleanTarget(suite: string) {
  const name = uniqueDatabaseName(suite);
  const dsn = await createCleanDatabase(cluster.adminDsn, name);
  const client = new pg.Client({ connectionString: dsn });
  await client.connect();
  return { dsn, client, name };
}

async function baselineHead(): Promise<string> {
  const manifest = await readFile(join(migrationRoot, "20260913T1711_data_plane_baseline/migration.json"), "utf8");
  return (JSON.parse(manifest) as { to: string }).to;
}

/** What the runner answers on: the first column of the step's one row. */
async function postcheckVerdict(client: pg.Client, sql: string): Promise<boolean> {
  const { rows } = await client.query<{ result: boolean }>(sql);
  return rows[0]?.result === true;
}

void test("a fresh database applies the whole chain and the marker names the checkout head", async () => {
  const { dsn, client, name } = await cleanTarget("native_chain_head");
  try {
    assert.match((await migrate(dsn)).stdout, /"migrationsApplied":2/);
    assert.match((await prisma(["db", "verify", "--db", dsn])).stdout, /Database schema satisfies contract/);
    assert.deepEqual((await client.query(markerQuery)).rows, [{ core_hash: contractJson.storage.storageHash }]);
    assert.deepEqual((await client.query(`SELECT
      (SELECT indexdef LIKE '%gin_trgm_ops%' FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_location_aliases_trgm') AS trigram,
      (SELECT indexdef LIKE '%(work_id, source, seq DESC)%' FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_raw_payload_history_work_source') AS history,
      (SELECT bool_and(attgenerated = 's' AND attnotnull) FROM pg_attribute WHERE attrelid = 'public.points'::regclass AND attname IN ('latitude', 'longitude') AND attnum > 0 AND NOT attisdropped) AS generated_coordinates,
      (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.points'::regclass AND attname = 'location') AS located,
      (SELECT count(*) = 0 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'points' AND column_name = 'embedding') AS no_embedding,
      (SELECT count(*) = 0 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_points_embedding') AS no_embedding_index,
      (SELECT count(*) = 0 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'location') AS no_location_column,
      (SELECT count(*) = 4 FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('sessions', 'turn_reservations', 'daily_usage', 'anon_daily_message_count')) AS agent_ledger,
      (SELECT count(*) = 1 FROM pg_trigger WHERE tgname = 'trg_sessions_updated_at' AND NOT tgisinternal) AS sessions_stamped`)).rows,
      [{ trigram: true, history: true, generated_coordinates: true, located: true, no_embedding: true, no_embedding_index: true, no_location_column: true, agent_ledger: true, sessions_stamped: true }]);
    const written = await client.query(`INSERT INTO points (id, name, location)
      VALUES ('coordinate-proof', 'Kyoto', ST_SetSRID(ST_MakePoint(135.7681, 35.0116), 4326)::geography)
      RETURNING ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude`);
    assert.deepEqual((await client.query("SELECT latitude, longitude FROM points WHERE id = 'coordinate-proof'")).rows, written.rows);
    await assert.rejects(client.query("UPDATE points SET latitude = 1"), { code: "428C9" });
  } finally { await client.end(); await dropCleanDatabase(cluster.adminDsn, name); }
});

void test("a direct write to a derived scalar column is refused, not corrected", async () => {
  const { dsn, client, name } = await cleanTarget("native_derived_refusal");
  try {
    await migrate(dsn);
    // #1217's class, proved unrepresentable: the database refuses the statement outright
    // (428C9, generated_always) instead of landing it and correcting the value afterwards.
    await assert.rejects(client.query("UPDATE points SET latitude = 1"), { code: "428C9" });
  } finally { await client.end(); await dropCleanDatabase(cluster.adminDsn, name); }
});

void test("a fresh database satisfies every exact-set grant postcheck the baseline declares", async () => {
  const { dsn, client, name } = await cleanTarget("native_chain_grants");
  try {
    await migrate(dsn);
    assert.ok(grantSteps.length > 50, `read only ${String(grantSteps.length)} grant steps`);
    for (const { description, sql } of grantSteps) assert.equal(await postcheckVerdict(client, sql), true, description);
  } finally { await client.end(); await dropCleanDatabase(cluster.adminDsn, name); }
});

void test("a dropped catalog grant fails the apply by role and table where effective privileges still answer yes", async () => {
  const directory = await droppedCatalogGrant();
  const { dsn, client, name } = await cleanTarget("native_chain_dropped_grant");
  try {
    // The blindness `has_table_privilege` has on Neon comes from privileges the grantee holds
    // outside its own ACL — there through `neon_superuser` membership, here through a default
    // privilege carried by PUBLIC. Membership cannot stand in for it: roles are cluster-global
    // and the container is shared (#1663), while a default privilege is this database's alone.
    await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO PUBLIC");
    await client.query("CREATE TABLE public.blindness_probe (id int)");
    assert.deepEqual((await client.query("SELECT has_table_privilege('catalog_svc', 'public.blindness_probe', 'UPDATE') AS result")).rows, [{ result: true }]);
    // The failed apply rolls its own work back — a rejected migration leaves no half-built
    // schema to inspect — so the failure text is the whole artefact: the runner's code, the
    // operation it happened in, and the step naming the role and the table.
    await assert.rejects(migrate(dsn, directory), (failure: unknown) => {
      const output = prismaCliOutput(failure);
      assert.match(output, /MIGRATION\.POSTCHECK_FAILED/u);
      assert.match(output, /data-plane-access/u);
      assert.match(output, /catalog_svc's explicit grants on aliases are exactly DELETE, INSERT, SELECT, UPDATE/u);
      return true;
    });
    assert.deepEqual((await client.query("SELECT count(*)::int AS aliases FROM pg_class WHERE relname = 'aliases'")).rows, [{ aliases: 0 }]);
  } finally { await client.end(); await dropCleanDatabase(cluster.adminDsn, name); await rm(directory, { recursive: true, force: true }); }
});

void test("replaying the applied chain changes neither the marker nor committed data", async () => {
  const { dsn, client, name } = await cleanTarget("native_chain_replay");
  try {
    await migrate(dsn);
    await client.query("INSERT INTO pi_sessions (id, metadata) VALUES ('preserved', '{\"id\":\"preserved\"}')");
    const marker = (await client.query("SELECT * FROM prisma_contract.marker ORDER BY 1")).rows;
    assert.match((await migrate(dsn)).stdout, /"migrationsApplied":0/);
    assert.deepEqual((await client.query("SELECT * FROM prisma_contract.marker ORDER BY 1")).rows, marker);
    assert.deepEqual((await client.query("SELECT id FROM pi_sessions")).rows, [{ id: "preserved" }]);
  } finally { await client.end(); await dropCleanDatabase(cluster.adminDsn, name); }
});

void test("an earlier head applies only up to itself and leaves the rest pending", async () => {
  const { dsn, client, name } = await cleanTarget("native_chain_earlier_head");
  try {
    const baseline = await baselineHead();
    assert.match((await migrate(dsn, packageRoot, baseline)).stdout, /"migrationsApplied":1/);
    assert.deepEqual((await client.query(markerQuery)).rows, [{ core_hash: baseline }]);
    assert.deepEqual((await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'agent_admissions' AND column_name = 'selection_request'")).rows, []);
    assert.match((await migrate(dsn)).stdout, /"migrationsApplied":1/);
    assert.deepEqual((await client.query(markerQuery)).rows, [{ core_hash: contractJson.storage.storageHash }]);
    const current = (await client.query("SELECT * FROM prisma_contract.marker ORDER BY 1")).rows;
    await assert.rejects(migrate(dsn, packageRoot, baseline), { stdout: /MIGRATION.PATH_UNREACHABLE/ });
    assert.deepEqual((await client.query("SELECT * FROM prisma_contract.marker ORDER BY 1")).rows, current);
    assert.deepEqual((await client.query("SELECT selection_request FROM agent_admissions")).rows, []);
  } finally { await client.end(); await dropCleanDatabase(cluster.adminDsn, name); }
});

void test("selecting artifact B while checkout is C applies only B and replay preserves its marker and data", async () => {
  const directory = await futureContract();
  const { dsn, client, name } = await cleanTarget("native_artifact_target");
  try {
    assert.match((await migrate(dsn, directory, contractJson.storage.storageHash)).stdout, /"migrationsApplied":2/);
    assert.match((await prisma(["db", "verify", "--db", dsn])).stdout, /Database schema satisfies contract/);
    await client.query("INSERT INTO pi_sessions (id, metadata) VALUES ('preserved', '{\"id\":\"preserved\"}')");
    assert.deepEqual((await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'pi_sessions' ORDER BY 1")).rows,
      [{ column_name: "id" }, { column_name: "metadata" }, { column_name: "next_seq" }]);
    const marker = (await client.query("SELECT * FROM prisma_contract.marker ORDER BY 1")).rows;
    assert.match((await migrate(dsn, directory, contractJson.storage.storageHash)).stdout, /"migrationsApplied":0/);
    assert.deepEqual((await client.query("SELECT * FROM prisma_contract.marker ORDER BY 1")).rows, marker);
    assert.deepEqual((await client.query("SELECT id FROM pi_sessions")).rows, [{ id: "preserved" }]);
    assert.match((await migrate(dsn, directory)).stdout, /"migrationsApplied":1/);
    const currentMarker = (await client.query("SELECT * FROM prisma_contract.marker ORDER BY 1")).rows;
    await assert.rejects(migrate(dsn, directory, contractJson.storage.storageHash), { stdout: /MIGRATION.PATH_UNREACHABLE/ });
    assert.deepEqual((await client.query("SELECT * FROM prisma_contract.marker ORDER BY 1")).rows, currentMarker);
    assert.deepEqual((await client.query("SELECT future_field FROM pi_sessions")).rows, [{ future_field: null }]);
  } finally { await client.end(); await dropCleanDatabase(cluster.adminDsn, name); await rm(directory, { recursive: true, force: true }); }
});

void test("a conflicting pre-existing Pi table is refused without adoption or partial creation", async () => {
  const { dsn, client, name } = await cleanTarget("native_conflict_refusal");
  try {
    await client.query("CREATE TABLE pi_records (legacy_value text); INSERT INTO pi_records VALUES ('preserved')");
    await assert.rejects(migrate(dsn));
    assert.deepEqual((await client.query("SELECT * FROM pi_records")).rows, [{ legacy_value: "preserved" }]);
    assert.deepEqual((await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows, [{ tablename: "pi_records" }]);
  } finally { await client.end(); await dropCleanDatabase(cluster.adminDsn, name); }
});

void test("a tampered migration body is refused and names the divergent migration", async () => {
  const { directory, firstMigration } = await tamperedContract();
  const name = uniqueDatabaseName("native_tampered_migration");
  const dsn = await createCleanDatabase(cluster.adminDsn, name);
  try {
    await assert.rejects(migrate(dsn, directory), (failure: unknown) => {
      const output = prismaCliOutput(failure);
      // `db migrate` refuses a tampered body in its pre-flight contract-space integrity
      // check, which is the code it emits; `migration check` is the verb that reports
      // MIGRATION.CHECK_HASH_MISMATCH for the same divergence (migration-integrity.unit.test.ts).
      assert.match(output, /MIGRATION\.CONTRACT_SPACE_VIOLATION/);
      assert.match(output, new RegExp(firstMigration));
      assert.match(output, /does not match computed hash/);
      return true;
    });
  } finally {
    await dropCleanDatabase(cluster.adminDsn, name);
    await rm(directory, { recursive: true, force: true });
  }
});
