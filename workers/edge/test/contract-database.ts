/**
 * The edge fixture's own Prisma-migrated database.
 *
 * The shared cluster (`startTestPostgresCluster`) provides the server, its admin
 * database and the five cluster-global service roles — no database of its own,
 * so the chain runs once per fixture, here (#1783; spec §4.7: one chain per
 * database). Everything the native routes read and write, including the
 * conversation ledger and the two usage meters, comes from the chain itself
 * rather than from scaffolding installed beside it.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, URL } from "node:url";
import { process } from "../test-support/node-globals.ts";
import { createCleanDatabase, dropCleanDatabase, uniqueDatabaseName, type TestPostgresCluster } from "@animichi/test-postgres";

const PI_SESSION_NEON = fileURLToPath(new URL("../../../packages/pi-session-neon/", import.meta.url));

function migrate(dsn: string): Promise<unknown> {
  return promisify(execFile)("pnpm", ["exec", "prisma", "db", "migrate", "--db", dsn, "--json"], {
    cwd: PI_SESSION_NEON, env: { ...process.env, DO_NOT_TRACK: "1" }, maxBuffer: 5 * 1024 * 1024,
  });
}

/** The fixture's own database on the shared server, and how to remove it (#1663). */
export interface ContractDatabase {
  readonly dsn: string;
  stop(): Promise<void>;
}

/** `<suite>_contract` plus a per-call suffix, created from pristine `template1` and migrated by
 * the one chain. The caller owns the drop, like every database creator. */
export async function startContractDatabase(cluster: TestPostgresCluster, suite: string): Promise<ContractDatabase> {
  const name = uniqueDatabaseName(`${suite}_contract`);
  const dsn = await createCleanDatabase(cluster.adminDsn, name);
  await migrate(dsn);
  return { dsn, stop: () => dropCleanDatabase(cluster.adminDsn, name) };
}
