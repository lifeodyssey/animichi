import type { DatabaseClient, QueryResult, QueryRow } from "./database";

// The retired GHA jobs supplied no override, so both scripts used the defaults at
// apps/agent/agent/config/cron_settings.py:37-47.
const RETENTION_DAYS = 30;
const MILLISECONDS_PER_DAY = 86_400_000;
const FOREIGN_KEY_VIOLATION = "23503";

// Port of apps/agent/agent/scripts/purge_anon_quota_counts.py:36,44.
// Exact source SQL: apps/agent/agent/infrastructure/supabase/repositories/anon_quota.py:40-42.
export const ANON_QUOTA_PURGE_SQL =
  "DELETE FROM anon_daily_message_count WHERE usage_date < $1";

// Port of apps/agent/agent/scripts/purge_anonymous_sessions.py:70-75.
// Exact source SQL: apps/agent/agent/infrastructure/supabase/repositories/session.py:31-37.
export const FIND_PURGEABLE_SESSIONS_SQL = [
  "SELECT c.session_id",
  "FROM conversations c",
  "WHERE c.user_id LIKE 'anon\\_%' ESCAPE '\\'",
  "  AND c.updated_at < $1",
  "  AND NOT EXISTS (SELECT 1 FROM routes r WHERE r.session_id = c.session_id)",
].join("\n");

// Port of apps/agent/agent/scripts/purge_anonymous_sessions.py:85-102.
// Source predicates/transaction: apps/agent/agent/infrastructure/supabase/repositories/session.py:45-50,242-265.
// The data-modifying CTE is one atomic Neon HTTP statement: an FK failure rolls back both deletes.
export const PURGE_ANONYMOUS_SESSION_SQL = [
  "WITH deleted_conversation AS (",
  "  DELETE FROM conversations",
  "  WHERE session_id = $1",
  "    AND user_id LIKE 'anon\\_%' ESCAPE '\\'",
  "    AND updated_at < $2",
  "  RETURNING session_id",
  ")",
  "DELETE FROM sessions",
  "WHERE id IN (SELECT session_id FROM deleted_conversation)",
].join("\n");

export interface PurgeReport {
  purged: number;
  raced: number;
  failed: number;
}

type PurgeOutcome = keyof PurgeReport;

function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - RETENTION_DAYS * MILLISECONDS_PER_DAY);
}

function quotaCutoff(now: Date): string {
  return retentionCutoff(now).toISOString().slice(0, 10);
}

function sessionId(row: QueryRow): string {
  const value = row.session_id;
  if (typeof value !== "string") throw new Error("Purge candidate has no string session_id");
  return value;
}

async function findPurgeableSessions(db: DatabaseClient, cutoff: Date): Promise<string[]> {
  const result = await db.query(FIND_PURGEABLE_SESSIONS_SQL, [cutoff]);
  return result.rows.map(sessionId);
}

function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === FOREIGN_KEY_VIOLATION;
}

async function purgeSession(
  db: DatabaseClient,
  sessionIdValue: string,
  cutoff: Date,
): Promise<PurgeOutcome> {
  try {
    return await deleteSession(db, sessionIdValue, cutoff);
  } catch (error) {
    return failedSession(error, sessionIdValue);
  }
}

async function deleteSession(
  db: DatabaseClient,
  sessionIdValue: string,
  cutoff: Date,
): Promise<PurgeOutcome> {
  const result = await db.query(PURGE_ANONYMOUS_SESSION_SQL, [sessionIdValue, cutoff]);
  return result.rowCount > 0 ? "purged" : "raced";
}

function failedSession(error: unknown, sessionIdValue: string): PurgeOutcome {
  if (!isForeignKeyViolation(error)) throw error;
  console.warn(JSON.stringify({ event: "anonymous_session_purge_failed", sessionIdValue }));
  return "failed";
}

function increment(report: PurgeReport, outcome: PurgeOutcome): void {
  report[outcome] += 1;
}

async function purgeEach(
  db: DatabaseClient,
  sessionIds: readonly string[],
  cutoff: Date,
): Promise<PurgeReport> {
  const report: PurgeReport = { purged: 0, raced: 0, failed: 0 };
  for (const id of sessionIds) increment(report, await purgeSession(db, id, cutoff));
  return report;
}

function logResult(event: string, result: QueryResult | PurgeReport): void {
  console.log(JSON.stringify({ event, ...result }));
}

export async function purgeAnonQuotaCounts(
  db: DatabaseClient,
  now = new Date(),
): Promise<number> {
  const cutoff = quotaCutoff(now);
  const result = await db.query(ANON_QUOTA_PURGE_SQL, [cutoff]);
  logResult("anon_quota_counts_purged", result);
  return result.rowCount;
}

export async function purgeAnonymousSessions(
  db: DatabaseClient,
  now = new Date(),
): Promise<PurgeReport> {
  const cutoff = retentionCutoff(now);
  const sessionIds = await findPurgeableSessions(db, cutoff);
  const report = await purgeEach(db, sessionIds, cutoff);
  logResult("anonymous_sessions_purged", report);
  return report;
}

export type { DatabaseClient, QueryResult } from "./database";
