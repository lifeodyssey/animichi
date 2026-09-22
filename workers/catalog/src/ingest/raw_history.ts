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
 *
 * Every statement is a builder plan over this request's Prisma runtime
 * ({@link CatalogPrisma}). The per-group ranking the cleanup needs is a window
 * function inside the plan's own projection, so the sweep reads back exactly the
 * rows it will delete and the hand-rolled row coercion the `unknown[]` seam
 * required has nowhere left to live.
 */
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../db/prisma";
import { asJsonValue } from "../lib/json";

/** How many newest raw payloads per work/source the cleanup retains. */
export const DEFAULT_KEEP_COUNT = 2;

/** A raw payload history row with its rank inside its own group. */
interface HistoryRow {
  seq: number;
  rank: number;
}

/** Append one fetched payload to the history, tagged with the capturing run. */
export async function appendRawHistory(
  query: CatalogPrisma,
  args: { workId: string; source: string; payload: object; runId?: string },
): Promise<void> {
  await query.executor.query(appendPlan(query, args));
}

/** The INSERT into raw_payload_history (run id optional for older fetches). */
function appendPlan(
  query: CatalogPrisma,
  args: { workId: string; source: string; payload: object; runId?: string },
): SqlOrmPlan {
  return query.builder.public.raw_payload_history
    .insert([{
      work_id: args.workId,
      source: args.source,
      payload: asJsonValue(args.payload),
      run_id: args.runId ?? null,
    }])
    .build();
}

/** Total history rows for a work/source — a diagnosis/assertion helper. */
export async function historyCount(
  query: CatalogPrisma,
  workId: string,
  source: string,
): Promise<number> {
  const rows = await query.executor.query(countPlan(query, workId, source));
  return rows[0]?.n ?? 0;
}

/** The COUNT over the work/source group. */
function countPlan(query: CatalogPrisma, workId: string, source: string): SqlOrmPlan<{ n: number }> {
  return query.builder.public.raw_payload_history
    .select((_fields, fns) => ({ n: fns.raw`count(*)::int`.returns("pg/int4@1") }))
    .where((fields, match) => match.and(
      match.eq(fields.work_id, workId),
      match.eq(fields.source, source),
    ))
    .build();
}

/** Bounded cleanup: keep the newest keepCount per group, protecting active runs. */
export async function cleanupRawHistory(
  query: CatalogPrisma,
  activeRunId: string,
  keepCount: number = DEFAULT_KEEP_COUNT,
): Promise<number> {
  assertKeep(keepCount);
  const rows = await query.executor.query(rankedPlan(query));
  const seqs = rows.filter((row) => row.rank > keepCount).map((row) => row.seq);
  if (seqs.length === 0) return 0;
  const deleted = await query.executor.query(deletePlan(query, seqs, activeRunId));
  return deleted.length;
}

/**
 * Every history row with its rank inside its own (work_id, source) group,
 * newest first — the window the retention bound is expressed over, so the
 * candidates are decided by the database's own ordering rather than by a
 * client-side pass over an untyped row list.
 */
function rankedPlan(query: CatalogPrisma): SqlOrmPlan<HistoryRow> {
  return query.builder.public.raw_payload_history
    .select((fields, fns) => ({
      seq: fields.seq,
      rank: fns.raw`row_number() over (partition by ${fields.work_id}, ${fields.source} order by ${fields.seq} desc)::int`.returns("pg/int4@1"),
    }))
    .build();
}

/** The DELETE ... WHERE seq IN (...) AND run_id IS DISTINCT FROM active. */
function deletePlan(
  query: CatalogPrisma, seqs: readonly number[], activeRunId: string,
): SqlOrmPlan<{ seq: number }> {
  return query.builder.public.raw_payload_history
    .delete()
    .where((fields, match) => match.and(
      match.in(fields.seq, [...seqs]),
      match.raw`coalesce(${fields.run_id}, '') <> ${activeRunId}`.returns("pg/bool@1"),
    ))
    .returning("seq")
    .build();
}

function assertKeep(keepCount: number): void {
  if (!Number.isInteger(keepCount) || keepCount < 1) {
    throw new Error("keepCount must be a positive integer");
  }
}
