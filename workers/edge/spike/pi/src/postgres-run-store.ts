// W0-S4 spike (#1247): `RunStore` over the real `runs` / `run_steps` tables.
//
// It is typed on Drizzle's driver-agnostic `PgDatabase`, not on
// `NeonHttpDatabase`, for one reason: the deployed spike reaches Neon over the
// HTTP driver (`spike-database.ts`, the convention `workers/users/src/db/client.ts`
// sets), while `db-test/` runs THIS SAME CLASS against a disposable PostgreSQL
// over node-postgres. A store that only existed in a Neon-shaped form would have
// to be re-implemented to be tested, and the tested copy would not be the shipped
// one.
//
// Every write is idempotent by construction rather than by transaction: the ids
// are generated once at intake and replayed verbatim, inserts are
// `ON CONFLICT DO NOTHING`, and each settlement is an UPDATE guarded by the state
// it is leaving. That is what makes the at-least-once alarm (spec §三: the
// RunSweeper may wake a run the DO is already driving) safe without a
// multi-statement transaction, which the Neon HTTP driver does not offer.
//
// The class stays a façade: one named statement per port method, each statement
// built by a module function below, so the SQL reads in one place.

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { messages, runSteps, runs } from "../../../src/db/schema.ts";
import { sessions } from "./session-table.ts";
import type {
  OpenTurnOutcome,
  PersistedStep,
  RunFailureReason,
  RunReport,
  RunStore,
  SettledStep,
  StepResult,
  TranscriptEntry,
  TurnIdentity,
} from "./run-store.ts";

/** Any Drizzle PostgreSQL database: Neon HTTP in the Worker, node-postgres in `db-test/`. */
export type SpikeRunDb = PgDatabase<PgQueryResultHKT>;

export class PostgresRunStore implements RunStore {
  private readonly db: SpikeRunDb;

  constructor(db: SpikeRunDb) {
    this.db = db;
  }

  async openTurn(turn: TurnIdentity, prompt: string, deadlineAt: Date): Promise<OpenTurnOutcome> {
    await insertSession(this.db, turn.sessionId);
    await insertMessage(this.db, turn.userMessageId, turn.sessionId, "user", prompt);
    return (await insertRun(this.db, turn, deadlineAt)).length === 1 ? "opened" : "session_busy";
  }

  async renewLease(runId: string, owner: string, until: Date): Promise<void> {
    await takeLease(this.db, runId, owner, until);
  }

  async loadSteps(runId: string): Promise<PersistedStep[]> {
    return (await selectSteps(this.db, runId)).map(toPersistedStep);
  }

  async settleStep(runId: string, step: SettledStep, finishedAt: Date): Promise<void> {
    await insertSettledStep(this.db, runId, step, finishedAt);
  }

  async completeTurn(turn: TurnIdentity, answer: string, finishedAt: Date): Promise<boolean> {
    await insertMessage(this.db, turn.assistantMessageId, turn.sessionId, "assistant", answer);
    return (await markSucceeded(this.db, turn.runId, finishedAt)).length === 1;
  }

  async failTurn(runId: string, reason: RunFailureReason, finishedAt: Date) {
    const settled = await markFailed(this.db, runId, reason, finishedAt);
    const refunded = await markQuotaRefunded(this.db, runId, finishedAt);
    return { settled: settled.length === 1, refunded: refunded.length === 1 };
  }

  async readRun(runId: string): Promise<RunReport | null> {
    const [row] = await this.db.select(runReportColumns()).from(runs).where(eq(runs.id, runId));
    return row ?? null;
  }

  async readTranscript(sessionId: string): Promise<TranscriptEntry[]> {
    return await selectTranscript(this.db, sessionId);
  }
}

/** The UTC day the quota reservation is charged against (`runs.quota_usage_date`). */
function usageDateOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** jsonb comes back untyped; this is the one place the spike parses it. */
function textField(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null) return "";
  const held = (value as Record<string, unknown>)[key];
  return typeof held === "string" ? held : "";
}

interface StepRow {
  stepIndex: number;
  toolName: string;
  input: unknown;
  result: unknown;
}

function toPersistedStep(row: StepRow): PersistedStep {
  return {
    stepIndex: row.stepIndex,
    toolName: row.toolName,
    input: { title: textField(row.input, "title") },
    result: readResult(row.result),
  };
}

function readResult(value: unknown): StepResult | null {
  return value === null || value === undefined ? null : { text: textField(value, "text") };
}

function insertSession(db: SpikeRunDb, sessionId: string) {
  return db.insert(sessions).values({ id: sessionId }).onConflictDoNothing();
}

function insertMessage(db: SpikeRunDb, id: string, sessionId: string, role: "user" | "assistant", content: string) {
  return db.insert(messages).values({ id, sessionId, role, content }).onConflictDoNothing();
}

/** The rows a settlement or a lease renewal may touch: this run, still running. */
function runningRun(runId: string) {
  return and(eq(runs.id, runId), eq(runs.status, "running"));
}

/**
 * Admission: losing this INSERT to `runs_one_running_per_session` IS the 409.
 * The conflict target names that partial index exactly — `(session_id) WHERE
 * status = 'running'` — so a unique constraint added later cannot be swallowed
 * as "session busy" for the wrong reason; it would raise, as it should.
 */
function insertRun(db: SpikeRunDb, turn: TurnIdentity, deadlineAt: Date) {
  return db
    .insert(runs)
    .values({
      id: turn.runId,
      sessionId: turn.sessionId,
      messageId: turn.userMessageId,
      deadlineAt,
      payer: "anon",
      quotaIdentityId: turn.sessionId,
      quotaUsageDate: usageDateOf(deadlineAt),
    })
    .onConflictDoNothing({ target: runs.sessionId, where: sql`${runs.status} = 'running'` })
    .returning({ id: runs.id });
}

/** `runs_lease_within_deadline_check` is a CHECK, so the clamp belongs in SQL. */
function takeLease(db: SpikeRunDb, runId: string, owner: string, until: Date) {
  const clamped = sql<Date>`least(${until.toISOString()}::timestamptz, ${runs.deadlineAt})`;
  return db
    .update(runs)
    .set({ leaseOwner: owner, leaseExpiresAt: clamped })
    .where(runningRun(runId));
}

function selectSteps(db: SpikeRunDb, runId: string) {
  return db
    .select({
      stepIndex: runSteps.stepIndex,
      toolName: runSteps.toolName,
      input: runSteps.input,
      result: runSteps.result,
    })
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(asc(runSteps.stepIndex));
}

/** `result` and `finished_at` land together — that is `run_steps_settled_check`. */
function insertSettledStep(db: SpikeRunDb, runId: string, step: SettledStep, finishedAt: Date) {
  return db.insert(runSteps).values({ runId, ...step, finishedAt }).onConflictDoNothing();
}

function markSucceeded(db: SpikeRunDb, runId: string, finishedAt: Date) {
  return db
    .update(runs)
    .set({ status: "succeeded", finishedAt, leaseOwner: null, leaseExpiresAt: null, usageSettledAt: finishedAt })
    .where(runningRun(runId))
    .returning({ id: runs.id });
}

function markFailed(db: SpikeRunDb, runId: string, reason: RunFailureReason, finishedAt: Date) {
  return db
    .update(runs)
    .set({ status: "failed", failureReason: reason, finishedAt, leaseOwner: null, leaseExpiresAt: null })
    .where(runningRun(runId))
    .returning({ id: runs.id });
}

/** Exactly-once: the marker is the WHERE clause, so a second call changes nothing. */
function markQuotaRefunded(db: SpikeRunDb, runId: string, at: Date) {
  return db
    .update(runs)
    .set({ quotaRefundedAt: at })
    .where(and(eq(runs.id, runId), isNull(runs.quotaRefundedAt)))
    .returning({ id: runs.id });
}

function selectTranscript(db: SpikeRunDb, sessionId: string) {
  return db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt), asc(messages.id));
}

/** Timestamps are cast to text in SQL so both drivers hand back the same shape. */
function runReportColumns() {
  return {
    runId: runs.id,
    sessionId: runs.sessionId,
    status: runs.status,
    failureReason: runs.failureReason,
    startedAt: sql<string>`${runs.startedAt}::text`,
    deadlineAt: sql<string>`${runs.deadlineAt}::text`,
    finishedAt: sql<string | null>`${runs.finishedAt}::text`,
    quotaRefundedAt: sql<string | null>`${runs.quotaRefundedAt}::text`,
    usageSettledAt: sql<string | null>`${runs.usageSettledAt}::text`,
    leaseExpiresAt: sql<string | null>`${runs.leaseExpiresAt}::text`,
  };
}
