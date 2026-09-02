// W0-S4 spike (#1247): the durable side of one agent turn, as a port.
//
// Everything the alarm-hosted state machine needs from Neon is named here and
// nowhere else, so `DurableTurn` can be driven in a unit test against a store
// double that enforces the same invariants the DDL enforces, and against the
// real `runs` / `run_steps` tables through `PostgresRunStore`.
//
// The vocabulary is the schema's (`workers/edge/src/db/schema.ts`, migration
// `migrations/neon/20260902000000_agent_runs.sql`): a run is `running` until it
// is `succeeded` or `failed`, a step is "already done" exactly when it has a
// `result`, and one session may hold one `running` run at a time.

import type { RUN_FAILURE_REASONS } from "../../../src/db/schema.ts";

export type RunFailureReason = (typeof RUN_FAILURE_REASONS)[number];

/** The ids one turn writes. Generated once, at intake, and replayed verbatim. */
export interface TurnIdentity {
  runId: string;
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
}

/** What a spike tool is asked for, and what it answers. Modelled, never `unknown`. */
export interface StepInput {
  title: string;
}

export interface StepResult {
  text: string;
}

/** One `run_steps` row as the replay reads it: `result` present = already done. */
export interface PersistedStep {
  stepIndex: number;
  toolName: string;
  input: StepInput;
  result: StepResult | null;
}

/** A step that finished: `result` and `finished_at` land together, per the CHECK. */
export interface SettledStep {
  stepIndex: number;
  toolName: string;
  input: StepInput;
  result: StepResult;
}

/** The intake's INSERT either opens the turn or loses to a running sibling. */
export type OpenTurnOutcome = "opened" | "session_busy";

/** What `failTurn` actually changed — both are exactly-once markers. */
export interface FailureSettlement {
  settled: boolean;
  refunded: boolean;
}

export interface RunReport {
  runId: string;
  sessionId: string;
  status: string;
  failureReason: string | null;
  startedAt: string;
  finishedAt: string | null;
  deadlineAt: string;
  quotaRefundedAt: string | null;
  usageSettledAt: string | null;
  leaseExpiresAt: string | null;
}

export interface TranscriptEntry {
  role: string;
  content: string;
}

export interface RunStore {
  /** Intake: session + user message + `runs(running)`. Admission is the INSERT. */
  openTurn(turn: TurnIdentity, prompt: string, deadlineAt: Date): Promise<OpenTurnOutcome>;
  /** Single-writer slice, clamped at `deadline_at` by the DDL's own CHECK. */
  renewLease(runId: string, owner: string, until: Date): Promise<void>;
  loadSteps(runId: string): Promise<PersistedStep[]>;
  /** Persists `(run_id, step_index)` BEFORE the loop continues (spec §三). */
  settleStep(runId: string, step: SettledStep, finishedAt: Date): Promise<void>;
  completeTurn(turn: TurnIdentity, answer: string, finishedAt: Date): Promise<boolean>;
  failTurn(runId: string, reason: RunFailureReason, finishedAt: Date): Promise<FailureSettlement>;
  readRun(runId: string): Promise<RunReport | null>;
  readTranscript(sessionId: string): Promise<TranscriptEntry[]>;
}
