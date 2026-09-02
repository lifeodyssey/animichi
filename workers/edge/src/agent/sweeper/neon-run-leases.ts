/**
 * The sweep's read, in SQL (issue #1251): the `running` runs whose lease is
 * expired or was never taken.
 *
 * It is `idx_runs_sweep` verbatim — `(status, lease_expires_at) WHERE status =
 * 'running'` — so the scan stays an index range however many settled runs the
 * table holds. The horizon is a parameter rather than SQL `now()`: the sweeper
 * owns the clock, which is what lets a test seed a lease that expired one
 * millisecond ago and one that expires one millisecond from now.
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

function selectStranded(nowMs: number): SQL {
  return sql`select ${runs.id} as run_id, ${runs.sessionId} as session_id
    from ${runs}
    where ${runs.status} = 'running'
      and (${runs.leaseExpiresAt} is null or ${runs.leaseExpiresAt} < ${new Date(nowMs).toISOString()})
    order by ${runs.leaseExpiresAt}
    limit ${SWEEP_BATCH_SIZE}`;
}

function toSweepableRun(row: unknown): SweepableRun | undefined {
  if (!isJsonRecord(row)) return undefined;
  const { run_id: runId, session_id: sessionId } = row;
  if (typeof runId !== "string" || typeof sessionId !== "string") return undefined;
  return { runId, sessionId };
}

async function strandedOn(statements: AgentStatements, nowMs: number): Promise<SweepableRun[]> {
  const result = await statements.execute(selectStranded(nowMs));
  return result.rows.map(toSweepableRun).filter((run) => run !== undefined);
}

/** The production `RunLeases`, over the agent data plane. */
export class NeonRunLeases implements RunLeases {
  readonly #transactions: AgentTransactions;

  constructor(transactions: AgentTransactions) {
    this.#transactions = transactions;
  }

  withoutLiveLease(nowMs: number): Promise<SweepableRun[]> {
    return this.#transactions.run((statements) => strandedOn(statements, nowMs));
  }
}
