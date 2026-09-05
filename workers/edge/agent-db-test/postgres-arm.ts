/**
 * The disposable PostgreSQL arm for the edge's agent-tier statements (#1251).
 *
 * The data plane itself — the offline image, the readiness wait, the clean
 * database from `template1`, the committed `migrations/neon` chain, and the one
 * wall-clock deadline the bind and the waits share (#1318) — is
 * `@animichi/test-postgres` (#1326), the same recipe `workers/catalog`'s spike
 * suite and `scripts/local-gates/db-fresh-schema.sh` run. What stays this arm's
 * own is what it does with the database once it exists, plus
 * `AGENT_DB_SETUP_BUDGET`: this lane boots one container PER FILE and runs the
 * files serially, so its first session can queue behind another boot and it
 * keeps 60 x 1 s rather than the spike suite's 30.
 *
 * The intake's statements run here through `drizzle-orm/node-postgres`, and in
 * production through `drizzle-orm/neon-serverless`. Both are pg-core drivers
 * over the same wire protocol reading the same `src/db/schema.ts` mapping, so
 * what is proven here is the SQL and the transaction semantics themselves —
 * only the connection adapter differs.
 */
import {
  AGENT_DB_SETUP_BUDGET,
  hookTimeoutMs,
  startTestPostgres,
  type TestPostgres,
} from "@animichi/test-postgres";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AgentStatements, AgentTransactions } from "../src/db/agent-database.ts";

const CLEAN_DATABASE = "edge_agent";

/** The wall-clock deadline the port bind and both connection waits share. */
export const SETUP_DEADLINE_MS = AGENT_DB_SETUP_BUDGET.deadlineMs;

/** What a `before` hook awaiting `startAgentDataPlane()` must allow: the
 * deadline plus the room its phases leave for the chain. */
export const SETUP_HOOK_TIMEOUT_MS = hookTimeoutMs(AGENT_DB_SETUP_BUDGET);

export interface AgentDataPlane {
  readonly transactions: AgentTransactions;
  readonly database: NodePgDatabase;
  stop(): Promise<void>;
}

function transactionsOn(database: NodePgDatabase): AgentTransactions {
  return { run: (work) => database.transaction((tx: AgentStatements) => work(tx)) };
}

/** Teardown order matters: drain the pool before the container goes away. */
function drainThenStop(pool: pg.Pool, postgres: TestPostgres): () => Promise<void> {
  return async () => {
    await pool.end();
    await postgres.stop();
  };
}

/** Pool the migrated database and expose it as the tier's transactions. */
function planeOn(postgres: TestPostgres): AgentDataPlane {
  const pool = new pg.Pool({ connectionString: postgres.dsn });
  const database = drizzle(pool);
  return { transactions: transactionsOn(database), database, stop: drainThenStop(pool, postgres) };
}

/** Boot the container, migrate a clean database, and hand back its transactions. */
export async function startAgentDataPlane(): Promise<AgentDataPlane> {
  return planeOn(
    await startTestPostgres({ database: CLEAN_DATABASE, budget: AGENT_DB_SETUP_BUDGET }),
  );
}
