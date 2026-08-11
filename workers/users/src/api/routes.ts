import type {
  ClaimSavedRoutesInput,
  ClaimSavedRoutesResult,
  ListSessionsInput,
  ListSessionsResult,
  ListSavedRoutesResult,
  UserSession,
} from "@animichi/contract";
import { sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "../db/client";
import type { SavedRouteRepo } from "../domain/ports";

/**
 * Thin HTTP mapping over the SavedRouteRepo port (src/domain/ports.ts).
 * Saved-route SQL lives in the Neon adapter
 * (src/adapters/neon-saved-route-repo.ts); domain decisions in
 * src/domain/route-rules.ts.
 *
 * TODO(refactor-skeleton): Share (expose a saved route to another user, #235)
 * and Check-in (record an on-site visit, #243) are product surfaces on the
 * user data plane — not implemented: no contract routes, no repo methods.
 */

/** ListSessionsInput caps offset at 1000 (packages/contract users-contract.ts). */
const MAX_LIST_OFFSET = 1_000;

type RecordRow = Record<string, unknown>;
interface DbRows { rows: unknown[] }

function isRecord(value: unknown): value is RecordRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function iso(value: unknown): string {
  if (typeof value !== "string" && !(value instanceof Date)) throw new Error("invalid timestamp row");
  return new Date(value).toISOString();
}

function requireSessionRow(
  value: RecordRow,
): { session_id: string; first_query: string; title: unknown } {
  const { session_id, first_query, title } = value;
  if (typeof session_id !== "string" || typeof first_query !== "string") {
    throw new Error("invalid session row");
  }
  return { session_id, first_query, title };
}

function toSession(value: unknown): UserSession {
  if (!isRecord(value)) throw new Error("invalid session row");
  const { session_id, first_query, title } = requireSessionRow(value);
  return {
    session_id, title: typeof title === "string" ? title : null,
    first_query, created_at: iso(value.created_at), updated_at: iso(value.updated_at),
  };
}

/** next_offset must stay within ListSessionsInput's offset cap (packages/contract
 * users-contract.ts): a next_offset the contract would reject is worse than
 * ending pagination early. */
function sessionPage(
  result: DbRows,
  input: ListSessionsInput,
): { sessions: UserSession[]; next_offset: number | null } {
  const sessions = result.rows.slice(0, input.limit).map(toSession);
  const next = input.offset + input.limit;
  const hasMore = result.rows.length > input.limit && next <= MAX_LIST_OFFSET;
  return { sessions, next_offset: hasMore ? next : null };
}

/** List saved routes owned by a user, newest update first. */
export async function listSavedRoutes(repo: SavedRouteRepo, userId: string): Promise<ListSavedRoutesResult> {
  return repo.listSavedRoutes(userId);
}

// TODO(refactor-skeleton): the conversation query and row normalization below
// remain inline because a session summary is not a saved route (not on
// SavedRouteRepo); extract to a SessionSummaryRepo port when sessions gain
// more operations.

function sessionSql(userId: string, input: ListSessionsInput): SQL {
  return sql`
    SELECT session_id, title, first_query, created_at, updated_at
    FROM conversations WHERE user_id = ${userId}
    ORDER BY updated_at DESC, session_id DESC
    LIMIT ${input.limit + 1} OFFSET ${input.offset}
  `;
}

/**
 * List session metadata owned by a user, newest first. The response is a
 * SessionSummary projection (id, title, first_query, timestamps) — not the
 * full conversation transcript, which lives in the agent's message store.
 */
export async function listSessions(
  db: DbExecutor, userId: string, input: ListSessionsInput,
): Promise<ListSessionsResult> {
  const result = await db.execute(sessionSql(userId, input));
  return sessionPage(result, input);
}

/** Atomically assign this session's still-anonymous saved routes to the caller. */
export async function claimSavedRoutes(
  repo: SavedRouteRepo,
  userId: string,
  input: ClaimSavedRoutesInput,
): Promise<ClaimSavedRoutesResult> {
  return repo.claimSavedRoutes(userId, input);
}
