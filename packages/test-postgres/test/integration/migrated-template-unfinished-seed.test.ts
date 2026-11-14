/**
 * SUT: `createMigratedDatabase` (`src/migrated-template.ts`) while the
 * template's seed is unfinished — still running in another caller, or left
 * behind by a caller that died.
 *
 * The seed creates the template, applies the chain, and only then protects it
 * (`ALLOW_CONNECTIONS false`, `IS_TEMPLATE true`). Reading "the template
 * exists" as "the template is ready" handed a caller a clone of an empty or
 * half-migrated database. Each case boots a container of its own, so the
 * template it leaves unprotected is never the shared container's.
 *
 * test-type: integration (boots its own container from the offline image).
 */
import test, { type TestContext } from "node:test";
import pg from "pg";
import {
  applyPrismaChain,
  ChainApplyTurn,
  createCleanDatabase,
  createMigratedDatabase,
  createServiceRoles,
  hookTimeoutMs,
  migratedTemplateName,
  SPIKE_SETUP_BUDGET,
  startOwnedPostgresCluster,
  uniqueDatabaseName,
  type TestPostgresCluster,
} from "../../src/index.ts";
import { assertChainSchema } from "./chain-schema.ts";

/** One container boot plus one chain apply: the budget's own hook ceiling. */
const CASE_TIMEOUT_MS = hookTimeoutMs(SPIKE_SETUP_BUDGET);

/** A container no other suite reaches, with the service roles the chain's
 * grant matrix prechecks. Stopped after the case, whatever the case did. */
async function ownCluster(t: TestContext): Promise<TestPostgresCluster> {
  const cluster = await startOwnedPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  t.after(() => cluster.stop());
  await createServiceRoles(cluster.adminDsn);
  return cluster;
}

/** The seed's own last two statements, in its order. */
async function protectTemplate(adminDsn: string, template: string): Promise<void> {
  const admin = new pg.Client(adminDsn);
  await admin.connect();
  try {
    await admin.query(`ALTER DATABASE "${template}" ALLOW_CONNECTIONS false`);
    await admin.query(`ALTER DATABASE "${template}" IS_TEMPLATE true`);
  } finally {
    await admin.end();
  }
}

/** The seed a caller runs inside the cluster turn, with the other callers'
 * requests arriving once the template exists and before it is migrated. The
 * clones come back wrapped: awaiting them in here would wait on callers that
 * may themselves be waiting for this turn. */
async function seedWhileCallersArrive(adminDsn: string, names: readonly string[]): Promise<{ clones: Promise<string[]> }> {
  const template = migratedTemplateName();
  const templateDsn = await createCleanDatabase(adminDsn, template);
  const clones = Promise.all(names.map((name) => createMigratedDatabase(adminDsn, name)));
  await applyPrismaChain(templateDsn);
  await protectTemplate(adminDsn, template);
  return { clones };
}

void test("two callers arriving during another caller's seed both clone the finished template", { timeout: CASE_TIMEOUT_MS }, async (t) => {
  const cluster = await ownCluster(t);
  const names = [uniqueDatabaseName("first_caller"), uniqueDatabaseName("second_caller")];
  const { clones } = await new ChainApplyTurn(cluster.adminDsn).hold(() => seedWhileCallersArrive(cluster.adminDsn, names));
  await Promise.all((await clones).map((dsn) => assertChainSchema(dsn)));
});

void test("a template a dead seed left unprotected is seeded again, not cloned", { timeout: CASE_TIMEOUT_MS }, async (t) => {
  const cluster = await ownCluster(t);
  await createCleanDatabase(cluster.adminDsn, migratedTemplateName());
  const dsn = await createMigratedDatabase(cluster.adminDsn, uniqueDatabaseName("after_dead_seed"));
  await assertChainSchema(dsn);
});
