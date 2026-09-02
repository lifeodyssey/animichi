// W0-S4 spike (#1247): the alarm-hosted turn, as a state machine.
//
// The loop the spec's §三 describes, with nothing else in it: walk the run's
// tool steps (each one resolved by `TurnStep`, which replays or executes and
// persists), then settle the turn. It knows nothing about Durable Objects, SSE
// or Neon drivers — the host supplies those — so the whole recovery matrix is
// drivable in a unit test with an injected clock and a store double that keeps
// the DDL's invariants.
//
// Three endings, and they are different on purpose:
//   succeeded      — every step settled, assistant message and `runs` row written.
//   failed         — the tool failed; the run is settled `failed` with a reason and
//                    the quota reservation is refunded exactly once.
//   InjectedCrash  — thrown out, deliberately NOT settled. The run stays `running`
//                    with a step whose result was never written, which is the
//                    "tool succeeded but result not yet persisted" branch the card
//                    demands; the alarm's own at-least-once retry (Cloudflare's
//                    Durable Objects `alarm()` contract: uncaught exception ⇒
//                    exponential-backoff retry) then replays it.

import { ToolFailure } from "./held-spot-lookup.ts";
import type { PendingTurn } from "./run-journal.ts";
import type { PersistedStep, RunFailureReason, StepResult } from "./run-store.ts";
import type { DurableTurnParts } from "./turn-parts.ts";
import { InjectedCrash, TurnStep } from "./turn-step.ts";

export type TurnEnding = "succeeded" | "failed";

function settledResult(steps: PersistedStep[], stepIndex: number): StepResult | null {
  return steps.find((step) => step.stepIndex === stepIndex)?.result ?? null;
}

function answerOf(results: StepResult[]): string {
  return results.map((result) => result.text).join(" | ");
}

function reasonOf(error: unknown): RunFailureReason {
  return error instanceof ToolFailure ? "tool_failed" : "internal_error";
}

export class DurableTurn {
  private readonly parts: DurableTurnParts;
  private readonly step: TurnStep;

  constructor(parts: DurableTurnParts) {
    this.parts = parts;
    this.step = new TurnStep(parts);
  }

  async run(pending: PendingTurn): Promise<TurnEnding> {
    const startedAt = this.parts.now();
    try {
      return await this.drive(pending);
    } catch (error) {
      return await this.settleFailure(pending, error);
    } finally {
      await this.parts.journal.addBilledMs(pending.identity.runId, this.parts.now() - startedAt);
    }
  }

  private async drive(pending: PendingTurn): Promise<TurnEnding> {
    const { runId } = pending.identity;
    const settled = await this.parts.store.loadSteps(runId);
    const results: StepResult[] = [];
    for (let index = 0; index < pending.command.toolCalls; index += 1) {
      results.push(await this.step.resolve(pending, index, settledResult(settled, index)));
    }
    await this.parts.store.completeTurn(pending.identity, answerOf(results), this.at());
    await this.parts.emit("turn_succeeded", { runId, steps: results.length });
    return "succeeded";
  }

  /** An injected crash is not an ending: it leaves the run `running` for the retry. */
  private async settleFailure(pending: PendingTurn, error: unknown): Promise<TurnEnding> {
    if (error instanceof InjectedCrash) throw error;
    const reason = reasonOf(error);
    const settlement = await this.parts.store.failTurn(pending.identity.runId, reason, this.at());
    await this.parts.emit("turn_failed", { reason, refunded: settlement.refunded });
    return "failed";
  }

  private at(): Date {
    return new Date(this.parts.now());
  }
}
