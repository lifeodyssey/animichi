/**
 * The intake's one transaction, in SQL (issue #1251). Three writes land
 * together or none do: the user message, the `running` run that owns it, and
 * the quota reservation the run names.
 *
 * The statements are `drizzle-orm` templates over the mapping in
 * `src/db/schema.ts` rather than the query builder, because the builder needs
 * a bound database instance and this adapter must run on any Postgres driver:
 * production is the Neon WebSocket pool, and `db-test/` proves the same
 * statements against a disposable PostgreSQL container.
 *
 * Both structural decisions of the turn ride database constraints rather than
 * a read-then-write:
 * - dedupe is `ON CONFLICT DO NOTHING` on the partial unique index
 *   `messages_session_client_message_id`;
 * - admission is the unique-key loss on `runs_one_running_per_session`.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AgentTransactions, AgentStatements } from "../../db/agent-database.ts";
import { bareName } from "../../db/column-name.ts";
import { isJsonRecord } from "../json-record.ts";
import { anonDailyMessageCount, messages, runs, sessions } from "../../db/schema.ts";
import type { QuotaReservation } from "./quota-reservation.ts";
import { allowanceExceeded, QuotaExhaustedError } from "./anonymous-message-allowance.ts";
import {
  SessionBusyError,
  SessionOwnershipError,
  type IntakeReceipt,
  type OpenedTurn,
  type TurnRecords,
  type TurnSubmission,
} from "./turn-intake.ts";

const UNIQUE_VIOLATION = "23505";
const RUNNING_PER_SESSION = "runs_one_running_per_session";

/**
 * The conversation the turn hangs off (`messages_session_id_fkey`), created on
 * its first turn and re-read on every later one (#1256). Python created the row
 * lazily from its own session store; the TS tier has no such store, so the
 * intake's transaction opens it.
 *
 * `do update` rather than `do nothing` on purpose: it makes the existing row's
 * owner READABLE through `returning` and takes that row's lock for the rest of
 * the transaction, so ownership is decided against a value nobody can change
 * underneath this turn. The SET is a no-op (`user_id` to itself) — an existing
 * conversation never changes hands here.
 */
function openSession(submission: TurnSubmission): SQL {
  return sql`insert into ${sessions} (${bareName(sessions.id)}, ${bareName(sessions.userId)})
    values (${submission.sessionId}, ${submission.identityId})
    on conflict (${bareName(sessions.id)})
    do update set ${bareName(sessions.userId)} = ${sessions.userId}
    returning ${bareName(sessions.userId)} as owner_id`;
}

/** The user message, unless this (session, client_message_id) already has one. */
function insertMessage(turn: OpenedTurn): SQL {
  const { submission } = turn;
  return sql`insert into ${messages}
      (${bareName(messages.sessionId)}, ${bareName(messages.role)}, ${bareName(messages.content)}, ${bareName(messages.clientMessageId)})
    values (${submission.sessionId}, 'user', ${submission.text}, ${submission.clientMessageId})
    on conflict (${bareName(messages.sessionId)}, ${bareName(messages.clientMessageId)})
      where ${bareName(messages.clientMessageId)} is not null
    do nothing
    returning ${bareName(messages.id)} as message_id`;
}

/** The message and run a replayed client_message_id already committed. */
function selectExistingTurn(submission: TurnSubmission): SQL {
  return sql`select ${messages.id} as message_id, ${runs.id} as run_id
    from ${messages} join ${runs} on ${runs.messageId} = ${messages.id}
    where ${messages.sessionId} = ${submission.sessionId}
      and ${messages.clientMessageId} = ${submission.clientMessageId}`;
}

/** The running run this turn is. Status, id and start time are the database's. */
function insertRun(turn: OpenedTurn, messageId: string): SQL {
  const { submission, reservation } = turn;
  return sql`insert into ${runs}
      (${bareName(runs.sessionId)}, ${bareName(runs.messageId)}, ${bareName(runs.deadlineAt)},
       ${bareName(runs.payer)}, ${bareName(runs.quotaIdentityId)}, ${bareName(runs.quotaUsageDate)})
    values (${submission.sessionId}, ${messageId}, ${turn.deadlineAt.toISOString()},
            ${submission.payer}, ${reservation?.identityId ?? null}, ${reservation?.usageDate ?? null})
    returning ${bareName(runs.id)} as run_id`;
}

/** Reserve one message on the counter row the run names (ported from the
 * Python `increment_and_count` upsert, now inside the turn transaction). */
function reserveMessage(reservation: QuotaReservation): SQL {
  const counter = anonDailyMessageCount;
  return sql`insert into ${counter}
      (${bareName(counter.usageDate)}, ${bareName(counter.anonId)}, ${bareName(counter.messageCount)}, ${bareName(counter.updatedAt)})
    values (${reservation.usageDate}, ${reservation.identityId}, 1, now())
    on conflict (${bareName(counter.usageDate)}, ${bareName(counter.anonId)})
    do update set ${bareName(counter.messageCount)} = ${counter.messageCount} + 1,
                  ${bareName(counter.updatedAt)} = now()
    returning ${bareName(counter.messageCount)} as message_count`;
}

function firstRow(result: { rows: unknown[] }): Record<string, unknown> | undefined {
  return result.rows.find(isJsonRecord);
}

function idIn(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  return typeof value === "string" ? value : undefined;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return isJsonRecord(error) && error.code === UNIQUE_VIOLATION && error.constraint === constraint;
}

/** Drivers raise the violation directly; a query wrapper carries it as `cause`. */
function violates(error: unknown, constraint: string): boolean {
  const cause = isJsonRecord(error) ? error.cause : undefined;
  return isUniqueViolation(error, constraint) || isUniqueViolation(cause, constraint);
}

/** The receipt a replay resolves to. A conflict with no readable run means the
 * message exists without one — a state this intake cannot produce, since it
 * commits both together. Refuse rather than open a second turn for it. */
async function replayedTurn(
  statements: AgentStatements,
  submission: TurnSubmission,
): Promise<IntakeReceipt> {
  const row = firstRow(await statements.execute(selectExistingTurn(submission)));
  const messageId = idIn(row, "message_id");
  const runId = idIn(row, "run_id");
  if (messageId === undefined || runId === undefined) {
    throw new SessionBusyError("orphaned_replay");
  }
  return { messageId, runId, replayed: true };
}

/** Admission: losing the session's single `running` slot is the busy answer. */
async function insertedRun(
  statements: AgentStatements,
  turn: OpenedTurn,
  messageId: string,
): Promise<{ rows: unknown[] }> {
  try {
    return await statements.execute(insertRun(turn, messageId));
  } catch (error) {
    if (violates(error, RUNNING_PER_SESSION)) throw new SessionBusyError("running_turn");
    throw error;
  }
}

async function openRun(
  statements: AgentStatements,
  turn: OpenedTurn,
  messageId: string,
): Promise<string> {
  const runId = idIn(firstRow(await insertedRun(statements, turn, messageId)), "run_id");
  if (runId === undefined) throw new Error("the runs insert returned no id");
  return runId;
}

/** The conversation this turn belongs to, refused when it is someone else's.
 * A session nobody owns is refused too: knowing its id buys no claim on it. */
async function ownedSession(statements: AgentStatements, submission: TurnSubmission): Promise<void> {
  const owner = idIn(firstRow(await statements.execute(openSession(submission))), "owner_id");
  if (owner !== submission.identityId) throw new SessionOwnershipError();
}

/**
 * Reserve one message and hold the identity to its daily allowance in the same
 * statement's transaction (#1256). The count compared is the one the upsert
 * just returned, so the read and the increment cannot be separated by another
 * turn: the counter row is locked from here to COMMIT. Over the ceiling the
 * whole transaction rolls back — no message, no run, no reservation.
 */
async function reserveOn(
  statements: AgentStatements, reservation: QuotaReservation, allowance: number,
): Promise<void> {
  const row = firstRow(await statements.execute(reserveMessage(reservation)));
  if (allowanceExceeded(Number(row?.message_count ?? 0), allowance)) {
    throw new QuotaExhaustedError(reservation.usageDate);
  }
}

/** Session, message, run and reservation on one transaction, in that order. */
async function openTurnOn(
  statements: AgentStatements, turn: OpenedTurn, allowance: number,
): Promise<IntakeReceipt> {
  await ownedSession(statements, turn.submission);
  const messageId = idIn(firstRow(await statements.execute(insertMessage(turn))), "message_id");
  if (messageId === undefined) return replayedTurn(statements, turn.submission);
  const runId = await openRun(statements, turn, messageId);
  if (turn.reservation !== null) await reserveOn(statements, turn.reservation, allowance);
  return { messageId, runId, replayed: false };
}

/** The production `TurnRecords`: one turn, one transaction. `allowance` is the
 * anonymous daily message ceiling this tier enforces (`0` = none). */
export class NeonTurnRecords implements TurnRecords {
  readonly #transactions: AgentTransactions;
  readonly #allowance: number;

  constructor(transactions: AgentTransactions, allowance = 0) {
    this.#transactions = transactions;
    this.#allowance = allowance;
  }

  openTurn(turn: OpenedTurn): Promise<IntakeReceipt> {
    return this.#transactions.run((statements) => openTurnOn(statements, turn, this.#allowance));
  }
}
