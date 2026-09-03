/**
 * The sweep's read, in SQL (issue #1251): the `running` runs whose lease is
 * expired or was never taken.
 *
 * It reads `idx_runs_sweep` — `(status, lease_expires_at) WHERE status =
 * 'running'` — so the scan stays an index range however many settled runs the
 * table holds. The horizon is a parameter rather than SQL `now()`: the sweeper
 * owns the clock, which is what lets a test seed a lease that expired one
 * millisecond ago and one that expires one millisecond from now.
 *
 * The two kinds of stranded run are read as two separately capped branches
 * rather than one ordered batch. A single `ORDER BY lease_expires_at LIMIT n`
 * sorts NULLs last in PostgreSQL, so a backlog of n expired leases would
 * starve the never-leased runs — and those are precisely the ones the backstop
 * exists for (a crash between COMMIT and `setAlarm`). Flipping to NULLS FIRST
 * only moves the starvation onto the other kind, so each branch gets its own
 * half of the batch and neither can crowd the other out. Within a branch the
 * order is oldest-first: by lease expiry for the expired ones, by `id` for the
 * never-leased, whose UUIDv7 primary key is already time-ordered (#992).
 *
 * Read-only by construction. Nothing here writes `runs`; reclaiming a run is
 * the AgentSession lease's decision, never the sweep's.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AgentStatements, AgentTransactions } from "../../db/agent-database.ts";
import { isJsonRecord } from "../json-record.ts";
import { runs } from "../../db/schema.ts";
import type { RunLeases, SweepableRun } from "./run-sweep.ts";

/**
 * How many stranded runs one alarm re-arms. A Durable Object alarm is a
 * bounded unit of work, and the runs left behind by an incident are unbounded;
 * anything past the batch is picked up by the next tick, which is what
 * at-least-once means.
 */
export const SWEEP_BATCH_SIZE = 100;

function selectStranded(nowMs: number, branchSize: number): SQL {
  return sql`(select ${runs.id} as run_id, ${runs.sessionId} as session_id
    from ${runs}
    where ${runs.status} = 'running' and ${runs.leaseExpiresAt} is null
    order by ${runs.id}
    limit ${branchSize})
  union all
  (select ${runs.id} as run_id, ${runs.sessionId} as session_id
    from ${runs}
    where ${runs.status} = 'running' and ${runs.leaseExpiresAt} < ${new Date(nowMs).toISOString()}
    order by ${runs.leaseExpiresAt}
    limit ${branchSize})`;
}

function toSweepableRun(row: unknown): SweepableRun | undefined {
  if (!isJsonRecord(row)) return undefined;
  const { run_id: runId, session_id: sessionId } = row;
  if (typeof runId !== "string" || typeof sessionId !== "string") return undefined;
  return { runId, sessionId };
}

async function strandedOn(
  statements: AgentStatements,
  nowMs: number,
  branchSize: number,
): Promise<SweepableRun[]> {
  const result = await statements.execute(selectStranded(nowMs, branchSize));
  return result.rows.map(toSweepableRun).filter((run) => run !== undefined);
}

/** The production `RunLeases`, over the agent data plane. */
export class NeonRunLeases implements RunLeases {
  readonly #transactions: AgentTransactions;
  readonly #branchSize: number;

  /** `batchSize` is the whole alarm's budget; each branch takes half of it. */
  constructor(transactions: AgentTransactions, batchSize: number = SWEEP_BATCH_SIZE) {
    this.#transactions = transactions;
    this.#branchSize = Math.max(1, Math.ceil(batchSize / 2));
  }

  withoutLiveLease(nowMs: number): Promise<SweepableRun[]> {
    return this.#transactions.run((statements) => strandedOn(statements, nowMs, this.#branchSize));
  }
}
