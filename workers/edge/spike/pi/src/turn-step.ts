// W0-S4 spike (#1247): one tool step of one run.
//
// The step is where the spec's idempotency contract (§三) actually lives: it
// either replays the `run_steps` row that already carries a `result`, or it
// takes the lease, runs the tool and writes `(run_id, step_index)` down BEFORE
// the loop is allowed to continue. `DurableTurn` owns the sequence of steps and
// the turn's endings; this owns what happens inside one of them.

import type { StepKey } from "./held-spot-lookup.ts";
import type { PendingTurn } from "./run-journal.ts";
import type { StepResult } from "./run-store.ts";
import type { DurableTurnParts } from "./turn-parts.ts";

/** How far past a step's hold the single-writer lease is taken; the DDL clamps it. */
export const LEASE_SLACK_MS = 30_000;

/** Thrown between "the tool returned" and "the step row is written". Never settled. */
export class InjectedCrash extends Error {}

export class TurnStep {
  private readonly parts: DurableTurnParts;

  constructor(parts: DurableTurnParts) {
    this.parts = parts;
  }

  async resolve(pending: PendingTurn, index: number, settled: StepResult | null) {
    if (settled !== null) {
      await this.parts.emit("step_replayed", { stepIndex: index });
      return settled;
    }
    await this.parts.store.renewLease(pending.identity.runId, this.parts.owner, leaseUntil(this.parts.now(), pending));
    return await this.execute(pending, index);
  }

  private async execute(pending: PendingTurn, index: number): Promise<StepResult> {
    const key = { runId: pending.identity.runId, stepIndex: index };
    const input = { title: pending.command.title };
    const result = await this.parts.toolbox.run(key, input);
    await this.crashIfInjected(pending, key);
    const step = { stepIndex: index, toolName: this.parts.toolbox.name, input, result };
    await this.parts.store.settleStep(key.runId, step, new Date(this.parts.now()));
    await this.parts.emit("step_settled", { stepIndex: index });
    return result;
  }

  /** Exactly between "the tool returned" and "the step row is written". */
  private async crashIfInjected(pending: PendingTurn, key: StepKey): Promise<void> {
    if (pending.command.crashBeforePersistStep !== key.stepIndex) return;
    if (!(await this.parts.journal.consumeCrash(key.runId))) return;
    throw new InjectedCrash(`crashed before writing step ${String(key.stepIndex)}`);
  }
}

function leaseUntil(now: number, pending: PendingTurn): Date {
  return new Date(now + pending.command.holdMs + LEASE_SLACK_MS);
}
