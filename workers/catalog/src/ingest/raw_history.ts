/**
 * Raw payload history (#1006 AC5): the latest and previous payload per work/source
 * for diagnosis, with bounded cleanup that can never delete an active run's
 * evidence.
 *
 * The existing raw_anitabi / raw_bangumi tables hold the single current payload;
 * this module appends every fetch to raw_payload_history so the ingest team can
 * compare against the previous payload. Retention is bounded: cleanup keeps the
 * newest keepCount rows per (work_id, source), and rows whose run_id is the
 * currently-active run are exempt even when they fall outside that bound — a
 * restarting run never loses its own evidence mid-flight.
 */
import { and, inArray, sql, type SQL } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { statementBuilder } from "../db/client";
import { rawPayloadHistory } from "../db/schema";

/** How many newest raw payloads per work/source the cleanup retains. */
export const DEFAULT_KEEP_COUNT = 2;

/** A raw payload history row as read by the cleanup sweep. */
interface HistoryRow {
  seq: number;
  workId: string;
  source: string;
  runId: string | null;
}

/** Append one fetched payload to the history, tagged with the capturing run. */
export async function appendRawHistory(
  db: CatalogDb,
  args: { workId: string; source: string; payload: unknown; runId?: string },
): Promise<void> {
  await db.execute(appendStatement(args));
}

/** The INSERT into raw_payload_history (run id optional for older fetches). */
function appendStatement(args: { workId: string; source: string; payload: unknown; runId?: string }): SQL {
  return statementBuilder()
    .insert(rawPayloadHistory)
    .values({
      workId: args.workId,
      source: args.source,
      payload: args.payload,
      runId: args.runId ?? null,
    })
    .getSQL();
}

/** Total history rows for a work/source — a diagnosis/assertion helper. */
export async function historyCount(
  db: CatalogDb,
  workId: string,
  source: string,
): Promise<number> {
  const rows = (await db.execute(countStatement(workId, source))).rows;
  return readCount(rows);
}

/** The COUNT over the work/source group. */
function countStatement(workId: string, source: string): SQL {
  return statementBuilder()
    .select({ n: countRows() })
    .from(rawPayloadHistory)
    .where(and(eqWork(workId), eqSource(source)))
    .getSQL();
}

/** Count(*)::int — a typed scalar aggregate fragment. */
function countRows(): SQL {
  return sql`COUNT(*)::int`;
}

/** The work_id = ? predicate fragment. */
function eqWork(workId: string): SQL {
  return sql`${rawPayloadHistory.workId} = ${workId}`;
}

/** The source = ? predicate fragment. */
function eqSource(source: string): SQL {
  return sql`${rawPayloadHistory.source} = ${source}`;
}

/** Bounded cleanup: keep the newest keepCount per group, protecting active runs. */
export async function cleanupRawHistory(
  db: CatalogDb,
  activeRunId: string,
  keepCount: number = DEFAULT_KEEP_COUNT,
): Promise<number> {
  const rows = (await db.execute(orderedRowsStatement())).rows;
  const deleteCandidates = collectCandidates(rows, keepCount);
  if (deleteCandidates.length === 0) return 0;
  const deleted = await db.execute(deleteStatement(deleteCandidates, activeRunId));
  return deleted.rows.length;
}

/** All history rows ordered by work_id, source, seq DESC. */
function orderedRowsStatement(): SQL {
  return statementBuilder()
    .select({
      seq: rawPayloadHistory.seq,
      workId: rawPayloadHistory.workId,
      source: rawPayloadHistory.source,
      runId: rawPayloadHistory.runId,
    })
    .from(rawPayloadHistory)
    .orderBy(sql`${rawPayloadHistory.workId} ASC, ${rawPayloadHistory.source} ASC, ${rawPayloadHistory.seq} DESC`)
    .getSQL();
}

/** The seqs beyond the newest keepCount within each group (deletion candidates). */
function collectCandidates(ordered: readonly unknown[], keepCount: number): number[] {
  assertKeep(keepCount);
  const rows = ordered.flatMap(rowOf);
  const counts = new Map<string, number>();
  const candidates: number[] = [];
  for (const row of rows) {
    const bucket = row.workId + "\u0000" + row.source;
    const kept = counts.get(bucket) ?? 0;
    counts.set(bucket, kept + 1);
    if (kept < keepCount) continue;
    candidates.push(row.seq);
  }
  return candidates;
}

/** The DELETE ... WHERE seq IN (...) AND run_id IS DISTINCT FROM active. */
function deleteStatement(seqs: readonly number[], activeRunId: string): SQL {
  return statementBuilder()
    .delete(rawPayloadHistory)
    .where(and(inArray(rawPayloadHistory.seq, [...seqs]), notActiveRun(activeRunId)))
    .returning({ seq: rawPayloadHistory.seq })
    .getSQL();
}

/** COALESCE(run_id, '') <> ? — exempt the active run's evidence. */
function notActiveRun(activeRunId: string): SQL {
  return sql`COALESCE(${rawPayloadHistory.runId}, '') <> ${activeRunId}`;
}

/** Coerce one raw history row to a typed value; malformed rows are dropped. */
function rowOf(value: unknown): HistoryRow[] {
  if (value === null || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const seq = record.seq;
  const workId = record.work_id;
  const source = record.source;
  const runId = record.run_id;
  if (typeof seq !== "number" || typeof workId !== "string" || typeof source !== "string") return [];
  return [{ seq, workId, source, runId: typeof runId === "string" ? runId : null }];
}

function readCount(rows: readonly unknown[]): number {
  const row = rows[0];
  if (typeof row !== "object" || row === null || !("n" in row)) return 0;
  const n = (row as Record<string, unknown>).n;
  return typeof n === "number" ? n : 0;
}

function assertKeep(keepCount: number): void {
  if (!Number.isInteger(keepCount) || keepCount < 1) {
    throw new Error("keepCount must be a positive integer");
  }
}
