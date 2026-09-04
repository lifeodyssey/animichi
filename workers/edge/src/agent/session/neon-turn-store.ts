/**
 * The alarm-hosted turn's durable side, in SQL (card #1252).
 *
 * Statements rather than the query builder, for the reason
 * `neon-turn-records.ts` gives: they must run on any Postgres driver, so the
 * `agent-db-test/` lane proves the very statements Neon runs.
 *
 * The lease is judged by the DATABASE's clock, not the caller's. Every
 * incarnation that could hold this lease reads the same `now()`, and a Durable
 * Object whose own clock has drifted must not be able to declare another
 * owner's live lease expired. The caller still supplies the EXPIRY it wants,
 * because that is a decision (the slice length), not an observation.
 *
 * Three transactions, three spec requirements:
 * - `persistStep` renews the lease as its FIRST statement and writes nothing
 *   when that compare-and-set finds another owner, so a run this incarnation
 *   has lost cannot append to it;
 * - the assistant tool-call message and the `run_steps` row land in that same
 *   transaction (Appendix C's requirement for this card);
 * - `settleSucceeded` writes the assistant message only when the settlement
 *   itself committed, so a retried alarm that loses the exactly-once UPDATE
 *   does not append a second answer to the transcript.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AgentStatements, AgentTransactions } from "../../db/agent-database.ts";
import { bareName } from "../../db/column-name.ts";
import {
  BYOK_PAYER,
  MESSAGE_ROLES,
  messages,
  runSteps,
  runs,
  type RunFailureReason,
} from "../../db/schema.ts";
import { isJsonRecord } from "../json-record.ts";
import { mintsIn } from "./minted-refs.ts";
import { settleFailedTurn, settleSucceededTurn } from "../settlement/neon-turn-settlement.ts";
import type { SettlementResult } from "../settlement/turn-settlement.ts";
import { storedSelection } from "../selection/selection-request.ts";
import { assistantTextOf } from "./turn-output.ts";
import {
  asJsonValue,
  type LoadedTurn,
  type PersistedStep,
  type SettledStep,
  type StepResult,
  type SucceededTurnRecord,
  type TranscriptRow,
  type TurnStore,
} from "./turn-store.ts";

/** The rows a lease may be taken on: this run, still running, and either
 * unheld, already ours, or expired on the database's own clock. */
function claimableRun(runId: string, owner: string): SQL {
  return sql`${runs.id} = ${runId} and ${runs.status} = 'running'
    and (${runs.leaseOwner} is null or ${runs.leaseOwner} = ${owner}
         or ${runs.leaseExpiresAt} < now())`;
}

/** `runs_lease_within_deadline_check` is a CHECK, so the clamp belongs in SQL. */
function setLease(owner: string, until: Date): SQL {
  return sql`${bareName(runs.leaseOwner)} = ${owner},
    ${bareName(runs.leaseExpiresAt)} = least(${until.toISOString()}::timestamptz, ${runs.deadlineAt})`;
}

function takeLeaseStatement(runId: string, owner: string, until: Date): SQL {
  return sql`update ${runs} set ${setLease(owner, until)}
    where ${claimableRun(runId, owner)}
    returning ${bareName(runs.id)} as run_id`;
}

/** A renewal is stricter than a claim: only a lease still ours and still live. */
function renewLeaseStatement(runId: string, owner: string, until: Date): SQL {
  return sql`update ${runs} set ${setLease(owner, until)}
    where ${runs.id} = ${runId} and ${runs.status} = 'running'
      and ${runs.leaseOwner} = ${owner} and ${runs.leaseExpiresAt} > now()
    returning ${bareName(runs.id)} as run_id`;
}

/** The run, joined to the user message it answers — the selection this turn is
 * (#1288) lives in that row's `response_data`, put there by the intake's own
 * transaction. The join is on `runs.message_id`, so it names this run's own
 * message rather than whichever user row happens to be last. */
function selectRun(runId: string): SQL {
  return sql`select ${runs.sessionId} as session_id, ${runs.payer} as payer,
      (extract(epoch from ${runs.deadlineAt}) * 1000)::bigint::text as deadline_ms,
      ${messages.responseData} as submitted
    from ${runs} join ${messages} on ${messages.id} = ${runs.messageId}
    where ${runs.id} = ${runId} and ${runs.status} = 'running'`;
}

function selectTranscript(sessionId: string): SQL {
  return sql`select ${messages.role} as role, ${messages.content} as content,
      ${messages.responseData} as response_data
    from ${messages} where ${messages.sessionId} = ${sessionId}
    order by ${messages.createdAt}, ${messages.id}`;
}

function selectSteps(runId: string): SQL {
  return sql`select ${runSteps.stepIndex} as step_index, ${runSteps.toolName} as tool_name,
      ${runSteps.input} as input, ${runSteps.result} as result
    from ${runSteps} where ${runSteps.runId} = ${runId} order by ${runSteps.stepIndex}`;
}

function insertMessage(sessionId: string, role: string, content: string, data: unknown): SQL {
  return sql`insert into ${messages}
      (${bareName(messages.sessionId)}, ${bareName(messages.role)},
       ${bareName(messages.content)}, ${bareName(messages.responseData)})
    values (${sessionId}, ${role}, ${content}, ${JSON.stringify(data ?? null)}::jsonb)`;
}

/** `result` and `finished_at` land together — that is `run_steps_settled_check`. */
function insertStep(runId: string, step: SettledStep, at: Date): SQL {
  return sql`insert into ${runSteps}
      (${bareName(runSteps.runId)}, ${bareName(runSteps.stepIndex)}, ${bareName(runSteps.toolName)},
       ${bareName(runSteps.input)}, ${bareName(runSteps.result)}, ${bareName(runSteps.finishedAt)})
    values (${runId}, ${step.stepIndex}, ${step.toolName},
            ${JSON.stringify(step.input)}::jsonb, ${JSON.stringify(step.result)}::jsonb,
            ${at.toISOString()})
    on conflict (${bareName(runSteps.runId)}, ${bareName(runSteps.stepIndex)}) do nothing`;
}

function committed(result: { rows: unknown[] }): boolean {
  return result.rows.some(isJsonRecord);
}

function textIn(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function isMessageRole(value: unknown): value is TranscriptRow["role"] {
  return typeof value === "string" && (MESSAGE_ROLES as readonly string[]).includes(value);
}

function toTranscriptRow(row: unknown): TranscriptRow | undefined {
  if (!isJsonRecord(row) || !isMessageRole(row.role)) return undefined;
  const held = row.response_data;
  return { role: row.role, content: textIn(row, "content"), responseData: asJsonValue(held) };
}

function toStepResult(value: unknown): StepResult | null {
  if (!isJsonRecord(value) || !Array.isArray(value.content)) return null;
  const content = value.content as StepResult["content"];
  return { content, details: asJsonValue(value.details), minted: mintsIn(value.minted) };
}

function toPersistedStep(row: unknown): PersistedStep | undefined {
  if (!isJsonRecord(row) || typeof row.step_index !== "number") return undefined;
  return {
    stepIndex: row.step_index,
    toolName: textIn(row, "tool_name"),
    input: asJsonValue(row.input),
    result: toStepResult(row.result),
  };
}

function present<T>(value: T | undefined): value is T {
  return value !== undefined;
}

async function loadTurnOn(statements: AgentStatements, runId: string): Promise<LoadedTurn | null> {
  const [run] = (await statements.execute(selectRun(runId))).rows.filter(isJsonRecord);
  if (run === undefined) return null;
  const sessionId = textIn(run, "session_id");
  const transcript = await statements.execute(selectTranscript(sessionId));
  const steps = await statements.execute(selectSteps(runId));
  return {
    runId,
    sessionId,
    deadlineAt: Number(textIn(run, "deadline_ms")),
    transcript: transcript.rows.map(toTranscriptRow).filter(present),
    steps: steps.rows.map(toPersistedStep).filter(present),
    callerKeyed: textIn(run, "payer") === BYOK_PAYER,
    selection: storedSelection(run.submitted),
  };
}

async function persistStepOn(
  statements: AgentStatements,
  turn: LoadedTurn,
  owner: string,
  step: SettledStep,
  slice: { leaseUntil: Date; at: Date },
): Promise<boolean> {
  const renewed = await statements.execute(renewLeaseStatement(turn.runId, owner, slice.leaseUntil));
  if (!committed(renewed)) return false;
  const envelope = step.toolCallMessage;
  if (envelope !== null) {
    const text = assistantTextOf(envelope.message);
    await statements.execute(insertMessage(turn.sessionId, "assistant", text, envelope));
  }
  await statements.execute(insertStep(turn.runId, step, slice.at));
  return true;
}

async function settleSucceededOn(
  statements: AgentStatements,
  record: SucceededTurnRecord,
  at: Date,
): Promise<SettlementResult> {
  const turn = { runId: record.runId, usage: record.usage, prices: record.prices };
  const settled = await settleSucceededTurn(statements, turn, at);
  if (settled === "already_settled") return settled;
  const { sessionId, answer, responseData } = record;
  await statements.execute(insertMessage(sessionId, "assistant", answer, responseData));
  return settled;
}

/** The production `TurnStore`, over the agent data plane. */
export class NeonTurnStore implements TurnStore {
  readonly #transactions: AgentTransactions;

  constructor(transactions: AgentTransactions) {
    this.#transactions = transactions;
  }

  takeLease(runId: string, owner: string, until: Date): Promise<boolean> {
    return this.#transactions.run(async (statements) =>
      committed(await statements.execute(takeLeaseStatement(runId, owner, until))));
  }

  loadRunningTurn(runId: string): Promise<LoadedTurn | null> {
    return this.#transactions.run((statements) => loadTurnOn(statements, runId));
  }

  persistStep(
    turn: LoadedTurn,
    owner: string,
    step: SettledStep,
    leaseUntil: Date,
    at: Date,
  ): Promise<boolean> {
    return this.#transactions.run((statements) =>
      persistStepOn(statements, turn, owner, step, { leaseUntil, at }));
  }

  settleSucceeded(record: SucceededTurnRecord, at: Date): Promise<SettlementResult> {
    return this.#transactions.run((statements) => settleSucceededOn(statements, record, at));
  }

  settleFailed(runId: string, reason: RunFailureReason, at: Date): Promise<SettlementResult> {
    return this.#transactions.run((statements) =>
      settleFailedTurn(statements, { runId, reason }, at));
  }
}
