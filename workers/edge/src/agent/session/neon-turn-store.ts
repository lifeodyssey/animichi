/**
 * The alarm-hosted turn's durable side, in SQL (card #1252).
 *
 * Statements rather than the query builder, for the reason
 * `neon-turn-records.ts` gives: they must run on any Postgres driver, so the
 * `agent-db-test/` lane proves the very statements Neon runs.
 *
 * A CLAIM is judged by the DATABASE's clock, not the caller's, so a Durable
 * Object whose own clock drifted cannot declare a live lease expired; the
 * EXPIRY stays the caller's, being a decision and not an observation. Mutual
 * exclusion, though, is the DURABLE OBJECT's rather than the lease's: `owner`
 * is the session DO's own id (`agent-session.ts`), constant across
 * incarnations, and `runs_one_running_per_session` keeps the running run unique
 * per session — so `lease_owner` never changes hands and the lease only gates
 * the stranded run the sweeper re-arms. Were that to slip, two writers sharing
 * an owner would both renew and `insertStep`'s `on conflict … do nothing` would
 * drop the loser's row while `persistStepOn` answered true — this failure class.
 *
 * Three transactions, three spec requirements:
 * - `persistStep` renews the lease as its FIRST statement and writes nothing
 *   when that compare-and-set finds another owner;
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
  toolCallEnvelopeOf,
  type LoadedTurn,
  type PersistedStep,
  type RunSteps,
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

/** A renewal is narrower than a claim in one way — the lease must still be OURS
 * — and a LAPSE is not part of it (#1397): only a step's write refreshes the
 * slice, and the model round trip between two steps is not bounded by it
 * (staging p90 24 s against 30 s), so refusing a lapse dropped the row. */
function renewLeaseStatement(runId: string, owner: string, until: Date): SQL {
  return sql`update ${runs} set ${setLease(owner, until)}
    where ${runs.id} = ${runId} and ${runs.status} = 'running'
      and ${runs.leaseOwner} = ${owner}
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

/**
 * The settled steps of EVERY run the session's transcript replays (#1377), in
 * one statement.
 *
 * Keyed on `run_steps`' own primary key rather than joined to `runs` on
 * `session_id`: the tool-call rows already carry the `run_id` that issued them,
 * `(run_id, step_index)` is the index this reads straight down, and `runs` has
 * no `session_id` index a join could use — only the partial unique one over the
 * single RUNNING row. One round trip either way, and this one touches no second
 * table.
 *
 * AN EARLIER RUN'S ROWS ARRIVE WITHOUT `minted`. That key holds the catalog
 * rows behind a ref, and only THIS run's mints are put back (`rehydrateRefs`,
 * `turn-attempt.ts`) — a foreign run's would be loaded, parsed and dropped.
 * Deleting it in SQL is what keeps the payload bounded by ONE run's rows
 * rather than the session's.
 *
 * What remains unbounded is the count: one row per settled step of every
 * issuing run the transcript still names, and the transcript is the whole
 * session. No ceiling can be put here without dropping a turn from the model's
 * history — the sliding window #1377 removed. What bounds the SIZE instead is
 * `result.summary`, the short form frozen when the step was written (#1378):
 * an earlier turn's result is replayed as that string, so a long row costs the
 * context one line however long its `content` is.
 */
function selectSteps(runId: string, runIds: readonly string[]): SQL {
  return sql`select ${runSteps.runId} as run_id, ${runSteps.stepIndex} as step_index,
      ${runSteps.toolName} as tool_name, ${runSteps.input} as input,
      case when ${runSteps.runId} = ${runId} then ${runSteps.result}
           else ${runSteps.result} - 'minted'::text end as result
    from ${runSteps} where ${runSteps.runId} in (${sql.join(runIds.map((id) => sql`${id}`), sql`, `)})
    order by ${runSteps.runId}, ${runSteps.stepIndex}`;
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
  const summary = typeof value.summary === "string" ? value.summary : undefined;
  return { content, details: asJsonValue(value.details), minted: mintsIn(value.minted), summary };
}

/** One `run_steps` row, under the run that numbered it. */
interface OwnedStep {
  readonly runId: string;
  readonly step: PersistedStep;
}

function toOwnedStep(row: unknown): OwnedStep | undefined {
  if (!isJsonRecord(row) || typeof row.step_index !== "number") return undefined;
  const step = {
    stepIndex: row.step_index,
    toolName: textIn(row, "tool_name"),
    input: asJsonValue(row.input),
    result: toStepResult(row.result),
  };
  return { runId: textIn(row, "run_id"), step };
}

function present<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function stepsByRun(owned: readonly OwnedStep[]): Map<string, PersistedStep[]> {
  const byRun = new Map<string, PersistedStep[]>();
  for (const { runId, step } of owned) {
    const held = byRun.get(runId) ?? [];
    held.push(step);
    byRun.set(runId, held);
  }
  return byRun;
}

/** The runs a rebuild has to answer: this one, and every earlier run whose
 * tool-call rows are still in the session's transcript (#1377). */
function issuingRunIds(transcript: readonly TranscriptRow[], runId: string): string[] {
  const issuing = new Set([runId]);
  for (const row of transcript) {
    const envelope = toolCallEnvelopeOf(row);
    if (envelope !== null) issuing.add(envelope.run_id);
  }
  return [...issuing];
}

function earlierStepsIn(byRun: Map<string, PersistedStep[]>, runId: string): RunSteps[] {
  const earlier = [...byRun].filter(([issued]) => issued !== runId);
  return earlier.map(([issued, steps]) => ({ runId: issued, steps }));
}

async function loadTurnOn(statements: AgentStatements, runId: string): Promise<LoadedTurn | null> {
  const [run] = (await statements.execute(selectRun(runId))).rows.filter(isJsonRecord);
  if (run === undefined) return null;
  const sessionId = textIn(run, "session_id");
  const loaded = await statements.execute(selectTranscript(sessionId));
  const transcript = loaded.rows.map(toTranscriptRow).filter(present);
  const owned = await statements.execute(selectSteps(runId, issuingRunIds(transcript, runId)));
  const byRun = stepsByRun(owned.rows.map(toOwnedStep).filter(present));
  return {
    runId,
    sessionId,
    deadlineAt: Number(textIn(run, "deadline_ms")),
    transcript,
    steps: byRun.get(runId) ?? [],
    earlierSteps: earlierStepsIn(byRun, runId),
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
  const { runId, usage, supplemental, prices } = record;
  const turn = { runId, usage, supplemental, prices };
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
