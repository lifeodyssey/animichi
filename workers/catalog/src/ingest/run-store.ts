/**
 * Run persistence over catalog_runs (#1006 AC1).
 *
 * A run row keyed by a STABLE run id records the discovered targets, per-source
 * outcomes, budget use, failures, completion state, and published versions as
 * JSONB snapshots. readRun / beginRun / recordRun are the idempotent gate +
 * transitions; every statement is a builder plan on the request's runtime
 * ({@link CatalogPrisma}), so retries never issue raw SQL.
 *
 * `beginRun` is the run's singleflight gate, and it is the one write here the
 * conflict clause does not serve: the gate has to leave a live run untouched,
 * which is `ON CONFLICT … DO UPDATE … WHERE` and the Postgres renderer emits no
 * conflict predicate. It is stated as the pair that predicate means — UPDATE the
 * row when it is claimable, else INSERT it — with the unique key deciding the
 * race between two callers that both found no row.
 */
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../db/prisma";
import { atServerNow } from "../db/plans";
import { asJsonValue } from "../lib/json";
import { isUniqueViolation } from "../lib/pg-error";
import type { RunSnapshot } from "./daily-run";

interface RunRow extends Record<string, unknown> {
  status: string;
  started_at: string | null;
  published_versions: unknown;
}

/** Read the recorded run snapshot, or null when no run exists for the id. */
export async function readRunRow(query: CatalogPrisma, runId: string): Promise<RunSnapshot | null> {
  const rows = await query.executor.query(readPlan(query, runId));
  const [first] = rows;
  return first === undefined ? null : snapshotOf(first);
}

/** The SELECT of status + reclaim signals for one run id. */
function readPlan(query: CatalogPrisma, runId: string): SqlOrmPlan<RunRow> {
  return query.builder.public.catalog_runs
    .select("status", "started_at", "published_versions")
    .where((fields, match) => match.eq(fields.run_id, runId))
    .build();
}

/** Atomically reserve the run row; false when another invocation owns it. */
export async function beginRunRow(query: CatalogPrisma, runId: string): Promise<boolean> {
  const reclaimed = await query.executor.query(reclaimPlan(query, runId));
  if (reclaimed.length > 0) return true;
  return insertRun(query, runId);
}

/**
 * Reclaim a run row that is not already running. This is the `setWhere` half of
 * the deleted `ON CONFLICT (run_id) DO UPDATE … WHERE status <> 'running'`:
 * `started_at` is deliberately NOT reassigned, exactly as the conflict clause
 * left it.
 */
function reclaimPlan(query: CatalogPrisma, runId: string): SqlOrmPlan<{ run_id: string }> {
  return query.builder.public.catalog_runs
    .update({ status: "running" })
    .where((fields, match) => match.and(
      match.eq(fields.run_id, runId),
      match.ne(fields.status, "running"),
    ))
    .returning("run_id")
    .build();
}

/** Start a run that has no row yet. A unique-key clash means another caller got there first. */
async function insertRun(query: CatalogPrisma, runId: string): Promise<boolean> {
  const plan = atServerNow(
    query.builder.public.catalog_runs
      .insert([{ run_id: runId, status: "running" }])
      .returning("run_id")
      .build(),
    ["started_at"],
  );
  try {
    return (await query.executor.query(plan)).length > 0;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/** Persist the full snapshot over the run row. */
export async function recordRunRow(query: CatalogPrisma, runId: string, snapshot: RunSnapshot): Promise<void> {
  await query.executor.query(recordPlan(query, runId, snapshot));
}

/** UPDATE the run row with the serialized snapshot. */
function recordPlan(query: CatalogPrisma, runId: string, snapshot: RunSnapshot): SqlOrmPlan {
  const terminal = isTerminal(snapshot.status);
  const update = query.builder.public.catalog_runs
    .update({
      status: snapshot.status,
      targets: snapshot.targets === null ? null : asJsonValue(snapshot.targets),
      source_outcomes: asJsonValue(snapshot.sources),
      budget_used: {
        workUsed: snapshot.budgetUsed.workUsed,
        requestUsed: snapshot.budgetUsed.requestUsed,
        runtimeUsedMs: snapshot.budgetUsed.runtimeUsedMs,
        firstExhausted: snapshot.firstExhausted,
      },
      failures: asJsonValue(snapshot.failures),
      published_versions: asJsonValue(snapshot.published),
      finished_at: null,
    })
    .where((fields, match) => match.eq(fields.run_id, runId))
    .build();
  // A terminal snapshot stamps the finish; a run still going clears it. The
  // stamp is the database's own clock, so it is applied as a plan repair rather
  // than bound as a value.
  return terminal ? atServerNow(update, ["finished_at"]) : update;
}

/** Whether a run status is one a run does not leave. */
function isTerminal(status: RunSnapshot["status"]): boolean {
  return status !== "running" && status !== "pending";
}

/** Mark a run failed with a reason (stale reclaim before a retry re-runs it). */
export async function markRunFailedRow(query: CatalogPrisma, runId: string, reason: string): Promise<void> {
  await query.executor.query(failPlan(query, runId, reason));
}

/** UPDATE the run row to failed with a reclaim marker and a finished timestamp. */
function failPlan(query: CatalogPrisma, runId: string, reason: string): SqlOrmPlan {
  const update = query.builder.public.catalog_runs
    .update({
      status: "failed",
      failures: asJsonValue([{ bangumiId: runId, stage: "reclaim", reason }]),
    })
    .where((fields, match) => match.eq(fields.run_id, runId))
    .build();
  return atServerNow(update, ["finished_at"]);
}

/** Coerce a catalog_runs row into a snapshot for the protocol's read gate. */
function snapshotOf(row: RunRow): RunSnapshot | null {
  if (typeof row.status !== "string") return null;
  return {
    status: row.status as RunSnapshot["status"],
    targets: null,
    sources: {},
    budgetUsed: { workUsed: 0, requestUsed: 0, runtimeUsedMs: 0 },
    firstExhausted: null,
    failures: [],
    published: parsePublished(row.published_versions),
    startedAtMs: parseStartedAt(row.started_at),
  };
}

/** Read the recorded `published_versions` JSONB as a version map, else empty. */
function parsePublished(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const key of Object.keys(value)) {
    const version = value[key];
    if (typeof version === "number") out[key] = version;
  }
  return out;
}

/** Coerce a timestamptz started_at (string or Date) to an ms epoch, else null. */
function parseStartedAt(value: unknown): number | null {
  if (value instanceof Date) return isValidDate(value) ? value.getTime() : null;
  if (typeof value === "string" && value.length > 0) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

/** A narrow object guard for JSONB payloads read back from the driver. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
