/**
 * The edge fixture's own Prisma-migrated database.
 *
 * `startTestPostgres` applies the same chain to the database it returns, so the
 * shared test plane is Prisma-applied rather than Atlas-applied (#1625); the five
 * cluster-global service roles are created on the image's admin database
 * (spec §4.7: one chain per database). This fixture keeps a database of its own
 * so an arm's migration turn is its own — everything the native routes read and
 * write, including the conversation ledger and the two usage meters, now comes
 * from the chain itself rather than from scaffolding installed beside it.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, URL } from "node:url";
import { process } from "../test-support/node-globals.ts";
import { createCleanDatabase, dropCleanDatabase, uniqueDatabaseName, type TestPostgres } from "@animichi/test-postgres";

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
export async function startContractDatabase(postgres: TestPostgres, suite: string): Promise<ContractDatabase> {
  const name = uniqueDatabaseName(`${suite}_contract`);
  const dsn = await createCleanDatabase(postgres.dsn, name);
  await migrate(dsn);
  return { dsn, stop: () => dropCleanDatabase(postgres.dsn, name) };
}
