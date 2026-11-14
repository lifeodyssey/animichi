/**
 * SUT: `createMigratedDatabase` (`src/migrated-template.ts`) while the
 * template's seed is unfinished — still running in another caller, or left
 * behind by a caller that died, before protecting the template or between the
 * two statements that protect it.
 *
 * The seed creates the template, applies the chain, and only then protects it
 * (`ALLOW_CONNECTIONS false`, `IS_TEMPLATE true`). Reading "the template
 * exists" as "the template is ready" handed a caller a clone of an empty or
 * half-migrated database. Each case boots a container of its own, so the
 * template it leaves unprotected is never the shared container's.
 *
 * test-type: integration (boots its own container from the offline image).
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
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
import { assertChainSchema, queryRows } from "./chain-schema.ts";

/** The budget's own hook ceiling: one container boot and the chain applies a case runs. */
const CASE_TIMEOUT_MS = hookTimeoutMs(SPIKE_SETUP_BUDGET);

/** Which database the template is, and how far it is protected. */
interface TemplateRow {
  readonly oid: string;
  readonly flags: { readonly datallowconn: boolean; readonly datistemplate: boolean };
}

/** A container no other suite reaches, with the service roles the chain's
 * grant matrix prechecks. Stopped after the case, whatever the case did. */
async function ownCluster(t: TestContext): Promise<TestPostgresCluster> {
  const cluster = await startOwnedPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  t.after(() => cluster.stop());
  await createServiceRoles(cluster.adminDsn);
  return cluster;
}

/** The first of the two statements the seed protects the template with. */
async function refuseConnections(adminDsn: string, template: string): Promise<void> {
  await queryRows(adminDsn, `ALTER DATABASE "${template}" ALLOW_CONNECTIONS false`);
}

/** The seed's own last two statements, in its order. */
async function protectTemplate(adminDsn: string, template: string): Promise<void> {
  await refuseConnections(adminDsn, template);
  await queryRows(adminDsn, `ALTER DATABASE "${template}" IS_TEMPLATE true`);
}

async function templateRow(adminDsn: string): Promise<TemplateRow> {
  const [row] = await queryRows<{ oid: string; datallowconn: boolean; datistemplate: boolean }>(adminDsn,
    "SELECT oid::text AS oid, datallowconn, datistemplate FROM pg_database WHERE datname = $1",
    [migratedTemplateName()]);
  assert.ok(row, `missing template ${migratedTemplateName()}`);
  return { oid: row.oid, flags: { datallowconn: row.datallowconn, datistemplate: row.datistemplate } };
}

/** A seed that died between its last two statements: fully migrated and
 * refusing connections, but never marked as a template. */
async function seedDiedBeforeMarking(adminDsn: string): Promise<TemplateRow> {
  const template = migratedTemplateName();
  await applyPrismaChain(await createCleanDatabase(adminDsn, template));
  await refuseConnections(adminDsn, template);
  return templateRow(adminDsn);
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

/** A clone would carry the chain schema either way, so what is read is the
 * template itself: seeded again means a new database, protected this time. */
void test("a template a dead seed left refusing connections but unmarked is seeded again", { timeout: CASE_TIMEOUT_MS }, async (t) => {
  const cluster = await ownCluster(t);
  const left = await seedDiedBeforeMarking(cluster.adminDsn);
  assert.deepEqual(left.flags, { datallowconn: false, datistemplate: false });
  await createMigratedDatabase(cluster.adminDsn, uniqueDatabaseName("after_half_protected_seed"));
  const reseeded = await templateRow(cluster.adminDsn);
  assert.deepEqual(reseeded.flags, { datallowconn: false, datistemplate: true });
  assert.notEqual(reseeded.oid, left.oid);
});
