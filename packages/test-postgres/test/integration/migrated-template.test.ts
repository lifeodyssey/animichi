/**
 * Seed one migrated template per container, then clone it (#1769).
 *
 * A clone is schema-identical to a database built by applying the chain:
 * tables, extensions, and prisma_contract.marker (Prisma's applied-chain
 * ledger). Six concurrent clones share no rows and do not take the chain-apply
 * lock. Cloning the pristine template fails by naming the missing chain object.
 *
 * test-type: integration (boots or reuses the offline image).
 */
import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { CHAIN_APPLY_LOCK_KEY } from "../../src/chain-apply-turn.ts";
import { migratedTemplateName } from "../../src/chain-identity.ts";
import { createCleanDatabase, dropCleanDatabase } from "../../src/clean-database.ts";
import { applyPrismaChain } from "../../src/prisma-chain.ts";
import { createMigratedDatabase } from "../../src/migrated-template.ts";
import { SPIKE_SETUP_BUDGET, startTestPostgresCluster, uniqueDatabaseName } from "../../src/index.ts";
import { assertChainSchema, queryRows, schemaSnapshot } from "./chain-schema.ts";

const CONCURRENT_CLONES = 6;

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

void test("cloning from the pristine template fails naming the missing chain object", async () => {
  const cluster = await startTestPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  const name = uniqueDatabaseName("pristine_clone");
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
