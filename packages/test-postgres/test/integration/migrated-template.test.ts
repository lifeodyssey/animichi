/**
 * Seed one migrated template per container, then clone it (#1769).
 *
 * A clone is schema-identical to a database built by applying the chain:
 * tables, extensions, and prisma_contract.marker (Prisma's applied-chain
 * ledger). Six concurrent clones share no rows and do not take the chain-apply
 * lock. Cloning template1 fails by naming the missing chain object.
 *
 * test-type: integration (boots or reuses the offline image).
 */
import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { CHAIN_APPLY_LOCK_KEY } from "../../src/chain-apply-turn.ts";
import { migratedTemplateName, prismaChainHead } from "../../src/chain-identity.ts";
import { createCleanDatabase, dropCleanDatabase } from "../../src/clean-database.ts";
import { applyPrismaChain } from "../../src/prisma-chain.ts";
import { createMigratedDatabase } from "../../src/migrated-template.ts";
import { SPIKE_SETUP_BUDGET, startTestPostgresCluster, uniqueDatabaseName } from "../../src/index.ts";

const CONCURRENT_CLONES = 6;
const CHAIN_TABLES = ["public.pi_sessions", "public.points", "prisma_contract.marker"] as const;
const CHAIN_EXTENSIONS = ["postgis", "pgcrypto", "pg_trgm", "vector"] as const;

interface SchemaSnapshot {
  readonly tables: readonly string[];
  readonly extensions: readonly string[];
  readonly marker: readonly { space: string; core_hash: string }[];
}

async function queryRows<Row extends pg.QueryResultRow>(dsn: string, statement: string, values: unknown[] = []): Promise<Row[]> {
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    return (await client.query<Row>(statement, values)).rows;
  } finally {
    await client.end();
  }
}

async function listedTables(dsn: string): Promise<string[]> {
  const tables = await queryRows<{ name: string }>(dsn,
    `SELECT schemaname || '.' || tablename AS name FROM pg_tables
     WHERE schemaname IN ('public', 'prisma_contract') ORDER BY 1`);
  return tables.map((row) => row.name);
}

async function listedExtensions(dsn: string): Promise<string[]> {
  const extensions = await queryRows<{ extname: string }>(dsn,
    "SELECT extname FROM pg_extension WHERE extname = ANY($1::text[]) ORDER BY 1", [CHAIN_EXTENSIONS]);
  return extensions.map((row) => row.extname);
}

async function schemaSnapshot(dsn: string): Promise<SchemaSnapshot> {
  const marker = await queryRows<{ space: string; core_hash: string }>(dsn,
    "SELECT space, core_hash FROM prisma_contract.marker ORDER BY space");
  return { tables: await listedTables(dsn), extensions: await listedExtensions(dsn), marker };
}

async function assertChainSchema(dsn: string): Promise<void> {
  const tables = await listedTables(dsn);
  for (const table of CHAIN_TABLES) {
    assert.ok(tables.includes(table), `missing object: ${table}`);
  }
  const extensions = await listedExtensions(dsn);
  for (const extension of CHAIN_EXTENSIONS) {
    assert.ok(extensions.includes(extension), `missing object: extension ${extension}`);
  }
  assert.deepEqual((await schemaSnapshot(dsn)).marker, [{ space: "app", core_hash: prismaChainHead() }]);
}

void test("a cloned database is schema-identical to one built by applying the chain", async () => {
  const cluster = await startTestPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  const appliedName = uniqueDatabaseName("applied_chain");
  const clonedName = uniqueDatabaseName("cloned_chain");
  const applied = await createCleanDatabase(cluster.adminDsn, appliedName);
  try {
    await applyPrismaChain(applied);
    const cloned = await createMigratedDatabase(cluster.adminDsn, clonedName);
    try {
      await assertChainSchema(cloned);
      assert.deepEqual(await schemaSnapshot(cloned), await schemaSnapshot(applied));
    } finally {
      await dropCleanDatabase(cluster.adminDsn, clonedName);
    }
  } finally {
    await dropCleanDatabase(cluster.adminDsn, appliedName);
  }
});

void test("six concurrent clones each get their own database and do not take the chain-apply lock", { timeout: 60_000 }, async () => {
  const cluster = await startTestPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  const seed = uniqueDatabaseName("clone_seed");
  await createMigratedDatabase(cluster.adminDsn, seed);
  const holder = new pg.Client(cluster.adminDsn);
  await holder.connect();
  const names = Array.from({ length: CONCURRENT_CLONES }, () => uniqueDatabaseName("clone_lock"));
  try {
    await holder.query("select pg_advisory_lock($1)", [CHAIN_APPLY_LOCK_KEY]);
    const dsns = await Promise.all(names.map((name) => createMigratedDatabase(cluster.adminDsn, name)));
    const [first, second] = dsns;
    assert.ok(first);
    assert.ok(second);
    await Promise.all(dsns.map((dsn) => assertChainSchema(dsn)));
    await queryRows(first, "CREATE TABLE clone_probe (id int)");
    await assert.rejects(queryRows(second, "SELECT * FROM clone_probe"), { code: "42P01" });
  } finally {
    await holder.end();
    await Promise.all([seed, ...names].map((name) => dropCleanDatabase(cluster.adminDsn, name)));
  }
});

void test("cloning from template1 fails naming the missing chain object", async () => {
  const cluster = await startTestPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  const name = uniqueDatabaseName("template1_clone");
  const dsn = await createCleanDatabase(cluster.adminDsn, name);
  try {
    await assert.rejects(() => assertChainSchema(dsn), { message: "missing object: public.pi_sessions" });
  } finally {
    await dropCleanDatabase(cluster.adminDsn, name);
  }
});

void test("the seeded template refuses connections the way template0 does", async () => {
  const cluster = await startTestPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  const name = uniqueDatabaseName("template_flags");
  await createMigratedDatabase(cluster.adminDsn, name);
  try {
    const [flags] = await queryRows<{ datallowconn: boolean; datistemplate: boolean }>(
      cluster.adminDsn, "SELECT datallowconn, datistemplate FROM pg_database WHERE datname = $1",
      [migratedTemplateName()]);
    assert.deepEqual(flags, { datallowconn: false, datistemplate: true });
  } finally {
    await dropCleanDatabase(cluster.adminDsn, name);
  }
});
