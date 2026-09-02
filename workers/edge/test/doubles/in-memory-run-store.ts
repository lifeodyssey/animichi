// A truthful `RunStore` for the W0-S4 tests (#1247).
//
// Truthful means it keeps the invariants the DDL keeps, not the ones that make a
// test pass. It is split the way the schema is — one small object per table, so
// each table's invariant is stated where that table lives: `messages` dedupes on
// the message id, `run_steps` is keyed by `(run_id, step_index)` and a rewrite
// leaves the first result alone, and `runs` admits one `running` run per session,
// only settles a run that is running, and marks the quota refund once.
//
// `db-test/spike-run-store.test.ts` runs the SAME assertions against
// `PostgresRunStore` on a real PostgreSQL, so this file cannot quietly drift
// into a friendlier database.

import type {
  FailureSettlement,
  OpenTurnOutcome,
  PersistedStep,
  RunFailureReason,
  RunReport,
  RunStore,
  SettledStep,
  TranscriptEntry,
  TurnIdentity,
} from "../../spike/pi/src/run-store.ts";

interface RunRow {
  sessionId: string;
  status: "running" | "succeeded" | "failed";
  failureReason: string | null;
  startedAt: string;
  finishedAt: string | null;
  deadlineAt: string;
  quotaRefundedAt: string | null;
  usageSettledAt: string | null;
  leaseExpiresAt: string | null;
}

/** The `messages` table: one row per id, read back in insertion order. */
class MemoryMessageLog {
  private readonly bySession = new Map<string, TranscriptEntry[]>();
  private readonly ids = new Set<string>();

  append(id: string, sessionId: string, role: string, content: string): void {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.bySession.set(sessionId, [...(this.bySession.get(sessionId) ?? []), { role, content }]);
  }

  transcript(sessionId: string): TranscriptEntry[] {
    return [...(this.bySession.get(sessionId) ?? [])];
  }
}

/** The `run_steps` table: `(run_id, step_index)` is the key, and it never rewrites. */
class MemoryStepLog {
  private readonly steps = new Map<string, PersistedStep>();

  settle(runId: string, step: SettledStep): void {
    const key = `${runId}#${String(step.stepIndex)}`;
    if (!this.steps.has(key)) this.steps.set(key, { ...step });
  }

  load(runId: string): PersistedStep[] {
    return [...this.steps]
      .filter(([key]) => key.startsWith(`${runId}#`))
      .map(([, step]) => step)
      .sort((left, right) => left.stepIndex - right.stepIndex);
  }
}

/** The `runs` table: one running run per session, and settlements that stick. */
class MemoryRunTable {
  private readonly rows = new Map<string, RunRow>();

  open(runId: string, sessionId: string, startedAt: string, deadlineAt: Date): OpenTurnOutcome {
    if (this.hasRunningRun(sessionId)) return "session_busy";
    this.rows.set(runId, newRunRow(sessionId, startedAt, deadlineAt));
    return "opened";
  }

  renewLease(runId: string, until: Date): void {
    const row = this.running(runId);
    if (row !== null) row.leaseExpiresAt = leaseWithin(until, row.deadlineAt);
  }

  settle(runId: string, status: "succeeded" | "failed", at: string, reason: string | null): boolean {
    const row = this.running(runId);
    if (row === null) return false;
    Object.assign(row, terminal(status, at), settlementOf(status, at, reason));
    return true;
  }

  refund(runId: string, at: string): boolean {
    const row = this.rows.get(runId);
    if (row === undefined || row.quotaRefundedAt !== null) return false;
    row.quotaRefundedAt = at;
    return true;
  }

  read(runId: string): RunReport | null {
    const row = this.rows.get(runId);
    return row === undefined ? null : { runId, ...row };
  }

  private hasRunningRun(sessionId: string): boolean {
    return [...this.rows.values()].some((row) => row.sessionId === sessionId && row.status === "running");
  }

  private running(runId: string): RunRow | null {
    const row = this.rows.get(runId);
    return row?.status === "running" ? row : null;
  }
}

export class InMemoryRunStore implements RunStore {
  private readonly runs = new MemoryRunTable();
  private readonly messages = new MemoryMessageLog();
  private readonly steps = new MemoryStepLog();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  openTurn(turn: TurnIdentity, prompt: string, deadlineAt: Date): Promise<OpenTurnOutcome> {
    const startedAt = new Date(this.now()).toISOString();
    const opened = this.runs.open(turn.runId, turn.sessionId, startedAt, deadlineAt);
    if (opened === "opened") this.messages.append(turn.userMessageId, turn.sessionId, "user", prompt);
    return Promise.resolve(opened);
  }

  renewLease(runId: string, _owner: string, until: Date): Promise<void> {
    this.runs.renewLease(runId, until);
    return Promise.resolve();
  }

  loadSteps(runId: string): Promise<PersistedStep[]> {
    return Promise.resolve(this.steps.load(runId));
  }

  settleStep(runId: string, step: SettledStep, _finishedAt: Date): Promise<void> {
    this.steps.settle(runId, step);
    return Promise.resolve();
  }

  completeTurn(turn: TurnIdentity, answer: string, finishedAt: Date): Promise<boolean> {
    this.messages.append(turn.assistantMessageId, turn.sessionId, "assistant", answer);
    return Promise.resolve(this.runs.settle(turn.runId, "succeeded", finishedAt.toISOString(), null));
  }

  failTurn(runId: string, reason: RunFailureReason, finishedAt: Date): Promise<FailureSettlement> {
    const at = finishedAt.toISOString();
    const settled = this.runs.settle(runId, "failed", at, reason);
    return Promise.resolve({ settled, refunded: this.runs.refund(runId, at) });
  }

  readRun(runId: string): Promise<RunReport | null> {
    return Promise.resolve(this.runs.read(runId));
  }

  readTranscript(sessionId: string): Promise<TranscriptEntry[]> {
    return Promise.resolve(this.messages.transcript(sessionId));
  }

}

function newRunRow(sessionId: string, startedAt: string, deadlineAt: Date): RunRow {
  return {
    sessionId,
    status: "running",
    failureReason: null,
    startedAt,
    finishedAt: null,
    deadlineAt: deadlineAt.toISOString(),
    quotaRefundedAt: null,
    usageSettledAt: null,
    leaseExpiresAt: null,
  };
}

/** `runs_terminal_is_finished_check` and `runs_lease_held_check`, in one move. */
function terminal(status: "succeeded" | "failed", finishedAt: string) {
  return { status, finishedAt, leaseExpiresAt: null };
}

/** A succeeded turn settles its usage; a failed one records why (`runs_failed_has_reason_check`). */
function settlementOf(status: "succeeded" | "failed", at: string, reason: string | null) {
  return status === "succeeded" ? { usageSettledAt: at } : { failureReason: reason };
}

/** `runs_lease_within_deadline_check`: a renewal never outlives the deadline. */
function leaseWithin(until: Date, deadlineAt: string): string {
  return until.toISOString() < deadlineAt ? until.toISOString() : deadlineAt;
}
