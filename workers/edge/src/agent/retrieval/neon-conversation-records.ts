/**
 * The retrieval's two reads, in SQL (W1-5 #1254).
 *
 * Read-only by construction: nothing here writes, which is also why this
 * adapter takes the narrow `AgentStatements` and not `AgentTransactions` the
 * way the writing adapters do. There is no atomicity to buy, and a
 * transaction per read would pay BEGIN/COMMIT round trips twice for a page a
 * visitor is waiting on. `readConversationOn` is the seam that puts both reads
 * on ONE unit of work, and it is what the route (#1256) mounts.
 *
 * `created_at` is rendered to ISO-8601 text by the DATABASE rather than by the
 * driver. A `timestamptz` comes back from `drizzle-orm/neon-serverless` under
 * workerd as a raw string and from `node-postgres` as a `Date`
 * (`workers/users/AGENTS.md`), and this column is published verbatim on a wire
 * the browser parses — so the format has to be decided in one place that both
 * drivers share.
 *
 * `revision` is the count of the session's committed turns. The Python route
 * reads it from `turn_reservations`, the CAS counter of the reservation
 * protocol the run table replaced (`runs_one_running_per_session` is the same
 * single-winner property); the TS tier never writes a reservation, so reading
 * that table here would freeze the number at whatever Python last left. One
 * run IS one turn, so counting runs is the same monotonic per-session turn
 * counter the field always meant.
 *
 * The two numbers are NOT comparable across the cut, and nothing compares
 * them: the CAS token a client echoes on its next turn is the one the chat
 * stream hands it in its session offer (`x-session-revision`,
 * `apps/web/src/features/chat/use-chat-session.ts`), never this page's field,
 * and the TS intake has no revision at all. This is a page number, and it is
 * monotonic per session on either side of #1256.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AgentStatements, AgentTransactions } from "../../db/agent-database.ts";
import type { GetSessionHistoryResponse } from "@animichi/contract/session-history-contract";
import { isJsonRecord } from "../json-record.ts";
import {
  messages,
  runSteps,
  runs,
  sessions,
  RUN_FAILURE_REASONS,
  RUN_STATUSES,
  type RunFailureReason,
} from "../../db/schema.ts";
import {
  readConversation,
  type ConversationFacts,
  type ConversationRecords,
  type ConversationRequest,
  type LatestRun,
  type SettledStepRow,
  type TranscriptPage,
} from "./conversation-retrieval.ts";
import type { TranscriptRow } from "./transcript-message.ts";

/**
 * Ownership, turn count and the latest run in one statement. The lateral join
 * reads `idx_runs_session_started` — `(session_id, started_at DESC)` — so
 * "the newest run of this session" is the index's first row rather than a sort
 * of the session's history. `id` breaks a tie: a UUIDv7 primary key is already
 * time-ordered (#992), so two runs stamped in the same instant still have one
 * unambiguous newest.
 */
function selectFacts(sessionId: string): SQL {
  return sql`select ${sessions.userId} as owner_id,
      (select count(*)::int from ${runs} where ${runs.sessionId} = ${sessions.id}) as turn_count,
      latest.run_id as run_id, latest.status as status, latest.failure_reason as failure_reason
    from ${sessions}
    left join lateral (
      select ${runs.id} as run_id, ${runs.status} as status, ${runs.failureReason} as failure_reason
      from ${runs} where ${runs.sessionId} = ${sessions.id}
      order by ${runs.startedAt} desc, ${runs.id} desc limit 1
    ) latest on true
    where ${sessions.id} = ${sessionId}`;
}

/** One window of the transcript, oldest first — `idx_messages_session_created`. */
function selectTranscript(sessionId: string, page: TranscriptPage): SQL {
  return sql`select ${messages.role} as role, ${messages.content} as content,
      ${messages.responseData} as response_data,
      to_json(${messages.createdAt}) #>> '{}' as created_at
    from ${messages}
    where ${messages.sessionId} = ${sessionId}
    order by ${messages.createdAt} asc
    limit ${page.limit} offset ${page.offset}`;
}

/**
 * The settled steps of the NAMED runs, oldest run first (E-2 #1381).
 *
 * Bounded by the caller's run list rather than by the session: the transcript
 * is paginated and `run_steps` is not, so a session-wide read would ship every
 * step the session ever settled on every page of it. The list is the page's own
 * runs (`conversation-retrieval.ts::scopedRunIds`), which is why the primary
 * key `(run_id, step_index)` is what this reads down.
 *
 * The join to `runs` stays for two reasons the list does not cover: the session
 * predicate keeps a run id that is not this session's unreadable no matter
 * where the list came from, and `started_at` is the only column that can order
 * two runs against each other. `input` is rendered to JSON text by the
 * DATABASE, for the reason `created_at` is: a `jsonb` comes back from the two
 * drivers this adapter runs on in different shapes, and this value is published
 * verbatim on a wire someone else parses.
 */
function selectSettledSteps(sessionId: string, runIds: readonly string[]): SQL {
  const named = sql.join(runIds.map((id) => sql`${id}`), sql`, `);
  return sql`select ${runSteps.runId} as run_id, ${runSteps.stepIndex} as step_index,
      ${runSteps.toolName} as tool_name, ${runSteps.input}::text as params
    from ${runSteps} join ${runs} on ${runs.id} = ${runSteps.runId}
    where ${runs.sessionId} = ${sessionId} and ${runSteps.runId} in (${named})
    order by ${runs.startedAt} asc, ${runs.id} asc, ${runSteps.stepIndex} asc`;
}

function firstRow(result: { rows: unknown[] }): Record<string, unknown> | undefined {
  return result.rows.find(isJsonRecord);
}

function textIn(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function runStatusIn(row: Record<string, unknown>): LatestRun["status"] | null {
  const status = textIn(row, "status");
  return RUN_STATUSES.find((known) => known === status) ?? null;
}

function failureReasonIn(row: Record<string, unknown>): RunFailureReason | null {
  const reason = textIn(row, "failure_reason");
  return RUN_FAILURE_REASONS.find((known) => known === reason) ?? null;
}

/** The latest run the facts row names, or none — the session has no run yet. */
function latestRunIn(row: Record<string, unknown>): LatestRun | null {
  const runId = textIn(row, "run_id");
  const status = runStatusIn(row);
  if (runId === null || status === null) return null;
  return { runId, status, failureReason: failureReasonIn(row) };
}

function toFacts(row: Record<string, unknown>): ConversationFacts {
  return {
    ownerId: textIn(row, "owner_id"),
    turnCount: Number(row.turn_count ?? 0),
    latestRun: latestRunIn(row),
  };
}

/** A row without a readable `created_at` is not a transcript row; the column
 * is NOT NULL, so this is a shape refusal and never an empty conversation. */
function toTranscriptRow(row: unknown): TranscriptRow[] {
  if (!isJsonRecord(row)) return [];
  const createdAt = textIn(row, "created_at");
  const role = textIn(row, "role");
  if (createdAt === null || role === null) return [];
  return [{ role, content: textIn(row, "content") ?? "", responseData: row.response_data, createdAt }];
}

/** A row without a readable run id or index answers for no step; `input` is
 * NOT NULL, so a missing `params` is a shape refusal and never empty params. */
function toSettledStepRow(row: unknown): SettledStepRow[] {
  if (!isJsonRecord(row) || typeof row.step_index !== "number") return [];
  const runId = textIn(row, "run_id");
  const params = textIn(row, "params");
  if (runId === null || params === null) return [];
  return [{ runId, stepIndex: row.step_index, toolName: textIn(row, "tool_name") ?? "", params }];
}

/** The production `ConversationRecords`, over the agent data plane. */
export class NeonConversationRecords implements ConversationRecords {
  readonly #statements: AgentStatements;

  constructor(statements: AgentStatements) {
    this.#statements = statements;
  }

  async factsOf(sessionId: string): Promise<ConversationFacts | null> {
    const row = firstRow(await this.#statements.execute(selectFacts(sessionId)));
    return row === undefined ? null : toFacts(row);
  }

  async transcriptOf(sessionId: string, page: TranscriptPage): Promise<TranscriptRow[]> {
    const result = await this.#statements.execute(selectTranscript(sessionId, page));
    return result.rows.flatMap(toTranscriptRow);
  }

  /** A page naming no run at all asks nothing — and `in ()` is not SQL. */
  async settledStepsOf(sessionId: string, runIds: readonly string[]): Promise<SettledStepRow[]> {
    if (runIds.length === 0) return [];
    const result = await this.#statements.execute(selectSettledSteps(sessionId, runIds));
    return result.rows.flatMap(toSettledStepRow);
  }
}

/** One retrieval on one unit of work — the seam the route mounts (#1256). */
export function readConversationOn(
  transactions: AgentTransactions,
  request: ConversationRequest,
): Promise<GetSessionHistoryResponse | null> {
  return transactions.run((statements) =>
    readConversation(new NeonConversationRecords(statements), request),
  );
}
