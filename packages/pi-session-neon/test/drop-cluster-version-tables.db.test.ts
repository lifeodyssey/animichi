import assert from "node:assert/strict";
import { test } from "node:test";
import { dropCleanDatabase } from "@animichi/test-postgres";
import type pg from "pg";
import contractJson from "../src/contract.json" with { type: "json" };
import { cleanTarget, headOf, markerQuery, postcheckVerdict } from "./clean-target.ts";
import { HEAD_GRANT_STEPS } from "./head-state.ts";
import { migrate, packageRoot, prisma, prismaCliOutput } from "./prisma-migration.ts";
import { cluster } from "./postgres.ts";

/** SUT: the chain's `drop_cluster_version_tables` migration, applied by `prisma db migrate` to a
 * database already at the head before it, the state a shared database is in when the migration
 * first reaches it. Both tables go with their keys, indexes and grants, every other row stays,
 * and a drop that fails leaves both tables and the marker exactly as they were. */

const PREVIOUS_MIGRATION = "20260913T1717_persist_selection_input";
const TABLES = ["cluster_version", "itinerary_snapshots"];
/** The two tables and the relations that exist only with them, their keys and indexes. */
const RELATIONS = [
  "cluster_version", "cluster_version_bangumi_id_version_key", "cluster_version_pkey", "idx_cluster_version_current",
  "idx_itinerary_snapshots_bangumi_version", "itinerary_snapshots", "itinerary_snapshots_pkey", "uq_cluster_version_one_current",
];
const KEPT_ROWS = [{ source: "bangumi", id: "kept" }, { source: "pi_sessions", id: "kept" }, { source: "points", id: "kept" }];

/** Which of `names` exist as relations in `public`, in byte order. */
async function relationsIn(client: pg.Client, names: readonly string[]): Promise<string[]> {
  const { rows } = await client.query<{ relname: string }>(`SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY($1) ORDER BY c.relname COLLATE "C"`, [names]);
  return rows.map((row) => row.relname);
}

/** One row in each dropped table, and one in each kind of table the drop runs beside. */
async function seedPreviousHead(client: pg.Client): Promise<void> {
  await client.query("INSERT INTO bangumi (id, title) VALUES ('kept', 'Kept')");
  await client.query("INSERT INTO points (id, name, location) VALUES ('kept', 'Kyoto', ST_SetSRID(ST_MakePoint(135.7681, 35.0116), 4326)::geography)");
  await client.query("INSERT INTO pi_sessions (id, metadata) VALUES ('kept', '{\"id\":\"kept\"}')");
  await client.query("INSERT INTO cluster_version (bangumi_id, version, is_current) VALUES ('kept', 1, true)");
  await client.query("INSERT INTO itinerary_snapshots (bangumi_id, cluster_version, payload) VALUES ('kept', 1, '{}')");
}

async function keptRows(client: pg.Client): Promise<{ source: string; id: string }[]> {
  const { rows } = await client.query<{ source: string; id: string }>(`SELECT 'bangumi' AS source, id FROM bangumi
    UNION ALL SELECT 'points', id FROM points UNION ALL SELECT 'pi_sessions', id FROM pi_sessions
    ORDER BY 1`);
  return rows;
}

void test("a database at the previous head loses both tables, their keys and indexes, and keeps every other row", async () => {
  const { dsn, client, name } = await cleanTarget("drop_tables_existing");
  try {
    assert.match((await migrate(dsn, packageRoot, await headOf(PREVIOUS_MIGRATION))).stdout, /"migrationsApplied":2/);
    await seedPreviousHead(client);
    assert.deepEqual(await relationsIn(client, RELATIONS), RELATIONS);
    assert.match((await migrate(dsn)).stdout, /"migrationsApplied":1/);
    assert.deepEqual((await client.query(markerQuery)).rows, [{ core_hash: contractJson.storage.storageHash }]);
    assert.deepEqual(await relationsIn(client, RELATIONS), []);
    assert.deepEqual(await keptRows(client), KEPT_ROWS);
    for (const { description, sql } of HEAD_GRANT_STEPS) assert.equal(await postcheckVerdict(client, sql), true, description);
    assert.match((await prisma(["db", "verify", "--db", dsn])).stdout, /Database schema satisfies contract/);
  } finally { await client.end(); await dropCleanDatabase(cluster.adminDsn, name); }
});

void test("a view on the table dropped second fails the migration, and both tables and the marker stay as they were", async () => {
  const { dsn, client, name } = await cleanTarget("drop_tables_dependent");
  try {
    const previous = await headOf(PREVIOUS_MIGRATION);
    await migrate(dsn, packageRoot, previous);
    await client.query("INSERT INTO cluster_version (bangumi_id, version, is_current) VALUES ('kept', 1, true)");
    await client.query("CREATE VIEW public.snapshot_reader AS SELECT bangumi_id FROM public.itinerary_snapshots");
    // The first drop has run when the second meets the view, so finding cluster_version afterwards
    // means the apply rolled back as one transaction, and a refusal means no CASCADE.
    await assert.rejects(migrate(dsn), (failure: unknown) => {
      const output = prismaCliOutput(failure);
      assert.match(output, /MIGRATION\.EXECUTION_FAILED/u);
      assert.match(output, /Operation dropTable\.itinerary_snapshots failed during execution/u);
      return true;
    });
    assert.deepEqual((await client.query(markerQuery)).rows, [{ core_hash: previous }]);
    assert.deepEqual(await relationsIn(client, TABLES), TABLES);
    assert.deepEqual((await client.query("SELECT bangumi_id FROM cluster_version")).rows, [{ bangumi_id: "kept" }]);
  } finally { await client.end(); await dropCleanDatabase(cluster.adminDsn, name); }
});
