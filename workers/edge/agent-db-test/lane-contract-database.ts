/**
 * The one contract database the `test:agent-db` lane shares, and the ordered
 * teardown that lets it be dropped (#1771).
 *
 * The lane runs `--test-isolation=none`, so every fixture's top-level hook is
 * registered against the ROOT suite: one process, one hook list, one database
 * is enough. That same fact is why the drop lives here and nowhere else —
 * root-level `after` hooks run in registration order, and this module is
 * imported by the fixtures before their own bodies run, so any `after` a
 * fixture added would run AFTER this one and its client would still be open
 * when the database went away. The fixtures therefore keep no `after` at all:
 * they take their client or pool from here, and this module closes what it
 * handed out before it drops.
 *
 * Each fixture keeps its own client and its own `beforeEach`; the tables they
 * clean are disjoint, and sharing does not merge them.
 */
import { after } from "node:test";
import pg from "pg";
import { AGENT_DB_SETUP_BUDGET, startTestPostgresCluster } from "@animichi/test-postgres";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "@animichi/pi-session-neon/types";
import { nativeClient } from "../src/native-client.ts";
import { startContractDatabase, type ContractDatabase } from "../test/contract-database.ts";

let opening: Promise<ContractDatabase> | undefined;
const closes: (() => Promise<unknown>)[] = [];

async function open(): Promise<ContractDatabase> {
  const cluster = await startTestPostgresCluster({ budget: AGENT_DB_SETUP_BUDGET });
  return startContractDatabase(cluster, "native_agent_db");
}

/** Opened by whichever fixture's `before` runs first; every later call is the
 * same database. */
function lane(): Promise<ContractDatabase> {
  opening ??= open();
  return opening;
}

/** The lane database's DSN, for the routes that read it out of their env. */
export async function laneDsn(): Promise<string> {
  return (await lane()).dsn;
}

/** A Prisma client of the caller's own, on the lane database. */
export async function laneClient(): Promise<PostgresClient<Contract>> {
  const client = nativeClient(await laneDsn());
  closes.push(() => client.close());
  return client;
}

/** A `pg` pool of the caller's own, on the lane database. */
export async function lanePool(): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: await laneDsn() });
  closes.push(() => pool.end());
  return pool;
}

after(async () => {
  try { await Promise.all(closes.map((close) => close())); }
  finally { await (await lane()).stop(); }
});
