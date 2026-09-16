import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createCleanDatabase, dropCleanDatabase, uniqueDatabaseName } from "@animichi/test-postgres";
import pg from "pg";
import contractJson from "../src/contract.json" with { type: "json" };
import { futureContract, tamperedContract } from "./migration-fixtures.ts";
import { migrate, packageRoot, prisma, prismaCliOutput } from "./prisma-migration.ts";
import { postgres } from "./postgres.ts";

const migrationRoot = fileURLToPath(new URL("../migrations/app/", import.meta.url));
const markerQuery = "SELECT core_hash FROM prisma_contract.marker WHERE space = 'app'";

/** Each test migrates its own database created from pristine `template1` — never the
 * Atlas-applied database `startTestPostgres` also prepares. The server is shared and outlives
 * this run (#1663), so the database this test owns is named per call and dropped by the test
 * that created it. */
async function cleanTarget(suite: string) {
  const name = uniqueDatabaseName(suite);
  const dsn = await createCleanDatabase(postgres.dsn, name);
  const client = new pg.Client({ connectionString: dsn });
  await client.connect();
  return { dsn, client, name };
}

async function baselineHead(): Promise<string> {
  const manifest = await readFile(join(migrationRoot, "20260913T1711_data_plane_baseline/migration.json"), "utf8");
  return (JSON.parse(manifest) as { to: string }).to;
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
      (SELECT count(*) = 0 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'location') AS no_location_column`)).rows,
      [{ trigram: true, history: true, generated_coordinates: true, located: true, no_embedding: true, no_embedding_index: true, no_location_column: true }]);
    const written = await client.query(`INSERT INTO points (id, name, location)
      VALUES ('coordinate-proof', 'Kyoto', ST_SetSRID(ST_MakePoint(135.7681, 35.0116), 4326)::geography)
      RETURNING ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude`);
    assert.deepEqual((await client.query("SELECT latitude, longitude FROM points WHERE id = 'coordinate-proof'")).rows, written.rows);
    await assert.rejects(client.query("UPDATE points SET latitude = 1"), { code: "428C9" });
  } finally { await client.end(); await dropCleanDatabase(postgres.dsn, name); }
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
  } finally { await client.end(); await dropCleanDatabase(postgres.dsn, name); }
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
  } finally { await client.end(); await dropCleanDatabase(postgres.dsn, name); }
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
  } finally { await client.end(); await dropCleanDatabase(postgres.dsn, name); await rm(directory, { recursive: true, force: true }); }
});

void test("a conflicting pre-existing Pi table is refused without adoption or partial creation", async () => {
  const { dsn, client, name } = await cleanTarget("native_conflict_refusal");
  try {
    await client.query("CREATE TABLE pi_records (legacy_value text); INSERT INTO pi_records VALUES ('preserved')");
    await assert.rejects(migrate(dsn));
    assert.deepEqual((await client.query("SELECT * FROM pi_records")).rows, [{ legacy_value: "preserved" }]);
    assert.deepEqual((await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows, [{ tablename: "pi_records" }]);
  } finally { await client.end(); await dropCleanDatabase(postgres.dsn, name); }
});

void test("a tampered migration body is refused and names the divergent migration", async () => {
  const { directory, firstMigration } = await tamperedContract();
  const name = uniqueDatabaseName("native_tampered_migration");
  const dsn = await createCleanDatabase(postgres.dsn, name);
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
    await dropCleanDatabase(postgres.dsn, name);
    await rm(directory, { recursive: true, force: true });
  }
});
