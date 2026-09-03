/**
 * Row constructors for the agent-tier database tests (#1251). Named for what
 * they build, and every one of them writes through the same committed schema
 * the production statements do.
 */
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { isJsonRecord } from "../src/agent/json-record.ts";
import type { TurnSubmission } from "../src/agent/intake/turn-intake.ts";

export type AgentDatabase = NodePgDatabase;

/** Far enough out that `runs_lease_within_deadline_check` never gets in a
 * seeded row's way; the sweep reads leases, not deadlines. */
const FAR_DEADLINE = "2099-01-01T00:00:00.000Z";

/** The one row a single-row query returned. */
export function onlyRow(result: { rows: unknown[] }): Record<string, unknown> {
  const [row] = result.rows;
  if (!isJsonRecord(row)) throw new Error("expected exactly one row");
  return row;
}

/** One anonymous submission; overrides name what the case is about. */
export function makeSubmission(overrides: Partial<TurnSubmission> = {}): TurnSubmission {
  return {
    sessionId: "session-1",
    identityId: "anon_0123456789abcdef0123456789abcdef",
    payer: "anon",
    clientMessageId: "cmid-1",
    text: "秩父の聖地を回りたい",
    ...overrides,
  };
}

/** The session row every message and run hangs off (FK, ON DELETE CASCADE). */
export async function seedSession(database: AgentDatabase, sessionId: string): Promise<void> {
  await database.execute(
    sql`insert into sessions (id) values (${sessionId}) on conflict (id) do nothing`,
  );
}

export interface SeededRun {
  readonly sessionId: string;
  readonly status: "running" | "succeeded";
  /** ISO instant, or null for a run that never took a lease. */
  readonly leaseExpiresAt: string | null;
}

/** A session, its user message and one run in the state the case needs. */
export async function seedRun(database: AgentDatabase, run: SeededRun): Promise<string> {
  await seedSession(database, run.sessionId);
  const message = await database.execute(
    sql`insert into messages (session_id, role, content)
        values (${run.sessionId}, 'user', 'seeded') returning id`,
  );
  const messageId = String(onlyRow(message).id);
  return String(onlyRow(await database.execute(insertSeededRun(run, messageId))).id);
}

function insertSeededRun(run: SeededRun, messageId: string) {
  const owner = run.leaseExpiresAt === null ? null : "do-incarnation-1";
  const finishedAt = run.status === "running" ? null : FAR_DEADLINE;
  return sql`insert into runs
      (session_id, message_id, status, lease_owner, lease_expires_at, deadline_at, finished_at, payer)
    values (${run.sessionId}, ${messageId}, ${run.status}, ${owner}, ${run.leaseExpiresAt},
            ${FAR_DEADLINE}, ${finishedAt}, 'anon')
    returning id`;
}

/** How many rows one table holds right now. */
export async function countRows(database: AgentDatabase, table: string): Promise<number> {
  const counted = await database.execute(sql`select count(*)::int as total from ${sql.identifier(table)}`);
  return Number(onlyRow(counted).total);
}

/** Today's reserved message count for one anonymous identity. */
export async function reservedCount(database: AgentDatabase, anonId: string): Promise<number> {
  const counted = await database.execute(
    sql`select coalesce(sum(message_count), 0)::int as total
        from anon_daily_message_count where anon_id = ${anonId}`,
  );
  return Number(onlyRow(counted).total);
}
