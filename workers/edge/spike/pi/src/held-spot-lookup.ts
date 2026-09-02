// W0-S4 spike (#1247): the tool the long turn calls three times.
//
// It answers from the same fixed table the S1 probe uses — S4 measures the
// Durable Object state machine, not catalog latency — but it holds for `holdMs`
// first, and that hold is what makes a turn last the five minutes the spec's S4
// hard condition asks for. The hold is injected as a `sleep`, so a unit test
// drives a five-minute turn without waiting five minutes.
//
// It takes `(runId, stepIndex)` because that is the idempotency key the spec
// (§三) says a side-effecting tool must accept. This tool is read-only, so it
// uses the key only to record that it really ran, which is the evidence the
// replay never re-executes a settled step.

import type { StepInput, StepResult } from "./run-store.ts";
import type { ToolCallLedger } from "./run-journal.ts";
import { spotFor } from "./spot-lookup-tool.ts";

export const LONG_TURN_TOOL_NAME = "lookup_spot";

/** A tool failure mid-turn: the run ends `failed`, it does not crash the alarm. */
export class ToolFailure extends Error {}

export interface StepKey {
  runId: string;
  stepIndex: number;
}

export interface TurnToolbox {
  readonly name: string;
  run(key: StepKey, input: StepInput): Promise<StepResult>;
}

export type Sleep = (ms: number) => Promise<void>;

export class HeldSpotLookup implements TurnToolbox {
  readonly name = LONG_TURN_TOOL_NAME;

  private readonly holdMs: number;
  private readonly failAtStep: number | null;
  private readonly sleep: Sleep;
  private readonly ledger: ToolCallLedger;

  constructor(holdMs: number, failAtStep: number | null, sleep: Sleep, ledger: ToolCallLedger) {
    this.holdMs = holdMs;
    this.failAtStep = failAtStep;
    this.sleep = sleep;
    this.ledger = ledger;
  }

  async run(key: StepKey, input: StepInput): Promise<StepResult> {
    await this.sleep(this.holdMs);
    await this.ledger.recordCall(key.runId);
    const step = String(key.stepIndex);
    if (key.stepIndex === this.failAtStep) throw new ToolFailure(`lookup_spot failed at step ${step}`);
    return { text: `step ${step}: ${spotFor(input.title)}` };
  }
}
