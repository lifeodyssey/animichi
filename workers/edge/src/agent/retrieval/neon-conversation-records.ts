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
import type { GetSessionHistoryResponse } from "@animichi/contract/agent-contract";
import { isJsonRecord } from "../json-record.ts";
import {
  messages,
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
