/**
 * A `TurnStore` that keeps the invariants the DDL keeps (card #1252).
 *
 * Not a fake that always succeeds: the lease is a real compare-and-set against
 * an injected clock, `run_steps` really refuses a second row for a settled
 * `(run_id, step_index)`, and both settlements are guarded by the same
 * "still running" predicate their SQL is. A double that let any of those
 * through would make the replay and reclaim tests pass for the wrong reason.
 */
import type { RunFailureReason } from "../../src/db/schema.ts";
import {
  asJsonValue,
  type LoadedTurn,
  type PersistedStep,
  type RunSteps,
  type SettledStep,
  type SucceededTurnRecord,
  type TranscriptRow,
  type TurnStore,
} from "../../src/agent/session/turn-store.ts";
import type { SettlementResult } from "../../src/agent/settlement/turn-settlement.ts";
import type { SelectionRequest } from "../../src/agent/selection/selection-request.ts";

export interface SeededRun {
  readonly runId: string;
  readonly sessionId: string;
  readonly deadlineAt: number;
  readonly leaseOwner?: string;
  readonly leaseExpiresAt?: number;
  readonly transcript: TranscriptRow[];
  readonly steps: PersistedStep[];
  /** What the session's EARLIER runs settled (#1377) — what the rebuild answers
   * their tool-call rows from. Defaults to none, which is a first turn. */
  readonly earlierSteps?: RunSteps[];
  /** `runs.payer = 'byok'` — a run the caller paid for with their own key
   * (#1289). Defaults to false, the payer every existing case seeds. */
  readonly callerKeyed?: boolean;
  /** The deterministic selection this run IS, when it is one (#1288). */
  readonly selection?: SelectionRequest | null;
}

export class InMemoryTurnStore implements TurnStore {
  readonly #now: () => number;
  readonly #run: SeededRun;
  #status: "running" | "succeeded" | "failed" = "running";
  #owner: string | null;
  #expiresAt: number | null;
  readonly transcript: TranscriptRow[];
  readonly steps: PersistedStep[];
  /** Every step this store actually wrote, with the message that opened it. */
  readonly written: SettledStep[] = [];
  /** A database that refuses writes — the "crash before the step row" branch. */
  stepWritesFail = false;
  /** The first step index this store refuses: the "crash AFTER an earlier step
   * landed" branch, which is the one a replay has anything to rebuild from. */
  refuseStepsFrom = Number.POSITIVE_INFINITY;
  readonly succeeded: SucceededTurnRecord[] = [];
  /** The instant each settlement was told to stamp — the turn's own injected
   * clock, so a case can hold the ending to it rather than to the wall. */
  readonly succeededAt: Date[] = [];
  readonly failed: RunFailureReason[] = [];

  constructor(run: SeededRun, now: () => number) {
    this.#run = run;
    this.#now = now;
    this.#owner = run.leaseOwner ?? null;
    this.#expiresAt = run.leaseExpiresAt ?? null;
    this.transcript = [...run.transcript];
    this.steps = [...run.steps];
  }

  /** The lease as `runs` holds it: owner and expiry, or neither. */
  get lease(): { owner: string | null; expiresAt: number | null } {
    return { owner: this.#owner, expiresAt: this.#expiresAt };
  }

  takeLease(_runId: string, owner: string, until: Date): Promise<boolean> {
    const free = this.#owner === null || this.#owner === owner;
    const stale = this.#expiresAt !== null && this.#expiresAt < this.#now();
    if (this.#status !== "running" || !(free || stale)) return Promise.resolve(false);
    return Promise.resolve(this.#hold(owner, until));
  }

  loadRunningTurn(runId: string): Promise<LoadedTurn | null> {
    if (this.#status !== "running") return Promise.resolve(null);
    const { sessionId, deadlineAt } = this.#run;
    const transcript = [...this.transcript];
    const callerKeyed = this.#run.callerKeyed ?? false;
    const steps = [...this.steps];
    const earlierSteps = this.#run.earlierSteps ?? [];
    const selection = this.#run.selection ?? null;
    return Promise.resolve({
      runId, sessionId, deadlineAt, transcript, steps, earlierSteps, callerKeyed, selection,
    });
  }

  persistStep(
    _turn: LoadedTurn,
    owner: string,
    step: SettledStep,
    leaseUntil: Date,
  ): Promise<boolean> {
    const refused = this.stepWritesFail || step.stepIndex >= this.refuseStepsFrom;
    if (refused) return Promise.reject(new Error("connection reset"));
    const held = this.#owner === owner && (this.#expiresAt ?? 0) > this.#now();
    if (this.#status !== "running" || !held) return Promise.resolve(false);
    this.#hold(owner, leaseUntil);
    this.#append(step);
    return Promise.resolve(true);
  }

  settleSucceeded(record: SucceededTurnRecord, at: Date): Promise<SettlementResult> {
    if (this.#status !== "running") return Promise.resolve("already_settled");
    this.#status = "succeeded";
    this.succeeded.push(record);
    this.succeededAt.push(at);
    this.#release();
    return Promise.resolve("settled");
  }

  settleFailed(_runId: string, reason: RunFailureReason, _at: Date): Promise<SettlementResult> {
    if (this.#status !== "running") return Promise.resolve("already_settled");
    this.#status = "failed";
    this.failed.push(reason);
    this.#release();
    return Promise.resolve("settled");
  }

  #hold(owner: string, until: Date): true {
    this.#owner = owner;
    this.#expiresAt = Math.min(until.getTime(), this.#run.deadlineAt);
    return true;
  }

  #release(): void {
    this.#owner = null;
    this.#expiresAt = null;
  }

  /** `(run_id, step_index)` is the primary key: a second row is refused. */
  #append(step: SettledStep): void {
    const envelope = step.toolCallMessage;
    if (envelope !== null) {
      this.transcript.push({ role: "assistant", content: "", responseData: asJsonValue(envelope) });
    }
    const taken = this.steps.some((held) => held.stepIndex === step.stepIndex);
    if (taken) return;
    this.steps.push({ ...step });
    this.written.push(step);
  }
}
