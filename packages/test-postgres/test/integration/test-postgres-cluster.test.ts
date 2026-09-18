/**
 * The two entry points, against a real Docker daemon (#1783).
 *
 * A caller that creates its own databases asks for a CLUSTER: the shared server,
 * its admin DSN and the five service roles, with no database made and no chain
 * applied. A caller that reads the data plane asks for `startTestPostgres`, which
 * builds on that cluster and still applies the chain. Each test makes a query
 * that only succeeds through a role's grant, so a missing role or a missing
 * schema fails as exactly that.
 *
 * Roles are cluster-global and the reused container already has them from
 * earlier runs, so skipping their creation is only observable on a container no
 * call has provisioned yet: run this file with `TESTCONTAINERS_REUSE_ENABLE=false`
 * and each test boots a fresh one.
 *
 * test-type: integration (boots or reuses the offline image, opens real sessions).
 */
import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import {
  createCleanDatabase,
  dropCleanDatabase,
  SPIKE_SETUP_BUDGET,
  startTestPostgres,
  startTestPostgresCluster,
  uniqueDatabaseName,
} from "../../src/index.ts";

/** Who read a table, and how many rows it saw. */
interface Reading {
  readonly reader: string;
  readonly rows: number;
}

/** On one session this file owns: run `setup` in order, then read `table` as `agent_svc`. */
async function readAsAgent(dsn: string, setup: readonly string[], table: string): Promise<Reading[]> {
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    for (const statement of [...setup, "SET ROLE agent_svc"]) await client.query(statement);
    return (await client.query<Reading>(`SELECT current_user AS reader, count(*)::int AS rows FROM ${table}`)).rows;
  } finally {
    await client.end();
  }
}

void test("a cluster creates the service roles, and a role's grant works through its admin DSN", async () => {
  const cluster = await startTestPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  const name = uniqueDatabaseName("cluster_grant");
  const dsn = await createCleanDatabase(cluster.adminDsn, name);
  try {
    const setup = ["CREATE TABLE granted (id int)", "GRANT SELECT ON granted TO agent_svc"];
    assert.deepEqual(await readAsAgent(dsn, setup, "granted"), [{ reader: "agent_svc", rows: 0 }]);
  } finally {
    await dropCleanDatabase(cluster.adminDsn, name);
  }
});

void test("startTestPostgres still hands back the chain's schema, readable through the chain's grant", async () => {
  const plane = await startTestPostgres({ database: "cluster_default_chain", budget: SPIKE_SETUP_BUDGET });
  try {
    assert.deepEqual(await readAsAgent(plane.dsn, [], "pi_sessions"), [{ reader: "agent_svc", rows: 0 }]);
  } finally {
    await plane.stop();
  }
});
