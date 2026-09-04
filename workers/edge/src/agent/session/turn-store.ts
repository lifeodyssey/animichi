/**
 * The durable side of one alarm-hosted turn, as a port (card #1252, spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §三).
 *
 * Everything `DurableTurn` needs from Neon is named here and nowhere else, so
 * the state machine is drivable in `node:test` against a store double that
 * keeps the DDL's invariants, and the very same machine runs against the real
 * `runs` / `run_steps` / `messages` tables through `NeonTurnStore`.
 *
 * Three of the four methods are transactions rather than statements, and each
 * boundary is a spec requirement rather than a convenience:
 * - `takeLease` is a compare-and-set, because a sweep may re-arm a run another
 *   incarnation is already driving (§三 "扫描幂等 … 由 DO 侧租约保证");
 * - `persistStep` writes the assistant tool-call message and the `run_steps`
 *   row TOGETHER, which is what makes a retried alarm land on the same
 *   `step_index` (Appendix C's implementation requirement for this card);
 * - `settleSucceeded` puts the assistant message in the same transaction as
 *   `settleSucceededTurn` (§三 "结束 = assistant message + usage 结算 +
 *   run=succeeded 同一 TX").
 */
import type { AssistantMessage, ImageContent, JsonValue, TextContent } from "@earendil-works/pi-ai";
import type { MESSAGE_ROLES, RunFailureReason } from "../../db/schema.ts";
import type { SettlementResult, TurnUsage, UsagePrices } from "../settlement/turn-settlement.ts";

/**
 * A value that is already JSON, as the JSON type.
 *
 * Both ends of this narrowing are serialization boundaries: on the way out a
 * tool's arguments and details are about to be `JSON.stringify`d into a `jsonb`
 * column, and on the way in they are what that column handed back. The driver
 * types a `jsonb` read as `unknown` because it cannot know the column's shape;
 * it cannot be anything but JSON, so the fact is asserted once, here, instead of
 * at each of the four call sites that would otherwise carry an inline cast.
 */
export function asJsonValue(value: unknown): JsonValue {
  return (value ?? null) as JsonValue;
}

/** What a tool hands back to the model, as `run_steps.result` stores it. */
export type StepContent = TextContent | ImageContent;

/** A tool result, reduced to the two fields a replay has to reproduce. */
export interface StepResult {
  readonly content: StepContent[];
  readonly details: JsonValue;
}

/** One `run_steps` row as the replay reads it: `result` present = already done. */
export interface PersistedStep {
  readonly stepIndex: number;
  readonly toolName: string;
  readonly input: JsonValue;
  readonly result: StepResult | null;
}

/** One `messages` row of the session transcript. */
export interface TranscriptRow {
  readonly role: (typeof MESSAGE_ROLES)[number];
  readonly content: string;
  /** The pi assistant message this row carries, when it is a tool-call turn. */
  readonly responseData: JsonValue | null;
}

/** Everything one alarm needs to resume one run. */
export interface LoadedTurn {
  readonly runId: string;
  readonly sessionId: string;
  /** The non-renewable whole-turn budget, in epoch milliseconds. */
  readonly deadlineAt: number;
  readonly transcript: readonly TranscriptRow[];
  readonly steps: readonly PersistedStep[];
  /**
   * Whether the run was committed against the CALLER's own provider key —
   * `runs.payer = 'byok'` (#1289).
   *
   * It is here rather than as the raw payer because this is the only question
   * the loop asks of it, and it is a SAFETY question: the credential itself
   * lives in one Durable Object incarnation's heap and does not survive an
   * eviction, while this row does. Without it a caller-keyed run that came
   * back on a fresh incarnation would be indistinguishable from a plain one
   * and would be driven on the server's key — the fallback spec §四 S5
   * forbids.
   */
  readonly callerKeyed: boolean;
}

/**
 * What an assistant tool-call row stores in `messages.response_data`: which run
 * issued the calls, and the `step_index` its FIRST call was settled under. The
 * marker is what lets a later turn of the same session read an earlier turn's
 * row as plain text instead of trying to answer its calls from a step list that
 * belongs to a different run.
 */
export interface ToolCallEnvelope {
  readonly run_id: string;
  readonly step_index: number;
  readonly message: AssistantMessage;
}

/**
 * A step that finished. `toolCallMessage` is the assistant message that issued
 * the call and is present exactly when this step opens it — a later step of the
 * same assistant turn rides the message its first step already wrote.
 */
export interface SettledStep {
  readonly stepIndex: number;
  readonly toolName: string;
  readonly input: JsonValue;
  readonly result: StepResult;
  readonly toolCallMessage: ToolCallEnvelope | null;
}

/** The answer a succeeded turn commits, with what it spent producing it. */
export interface SucceededTurnRecord {
  readonly runId: string;
  readonly sessionId: string;
  readonly answer: string;
  readonly responseData: JsonValue | null;
  readonly usage: TurnUsage;
  readonly prices: UsagePrices;
}

export interface TurnStore {
  /**
   * Take the run's single-writer lease, or answer false. False means another
   * live incarnation holds it and THIS alarm must not run the turn.
   */
  takeLease(runId: string, owner: string, until: Date): Promise<boolean>;
  /** The run and everything already persisted for it; null when it is not `running`. */
  loadRunningTurn(runId: string): Promise<LoadedTurn | null>;
  /**
   * Assistant tool-call message + `run_steps` row + lease renewal, one
   * transaction. Answers whether the lease was still this owner's: false means
   * nothing was written and another incarnation has taken the run over.
   */
  persistStep(
    turn: LoadedTurn,
    owner: string,
    step: SettledStep,
    leaseUntil: Date,
    at: Date,
  ): Promise<boolean>;
  /** Assistant message + `settleSucceededTurn`, one transaction. */
  settleSucceeded(record: SucceededTurnRecord, at: Date): Promise<SettlementResult>;
  /** `settleFailedTurn` — the refund's exactly-once contract lives in its SQL. */
  settleFailed(runId: string, reason: RunFailureReason, at: Date): Promise<SettlementResult>;
}
