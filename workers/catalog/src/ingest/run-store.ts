/**
 * Run persistence over catalog_runs (#1006 AC1).
 *
 * A run row keyed by a STABLE run id records the discovered targets, per-source
 * outcomes, budget use, failures, completion state, and published versions as
 * JSONB snapshots. readRun / beginRun / recordRun are the idempotent gate +
 * transitions; statements are built with the Drizzle builder over the CatalogDb
 * seam so retries never issue raw SQL.
 */
import { eq, sql, type SQL } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { statementBuilder } from "../db/client";
import { catalogRuns } from "../db/schema";
import type { RunSnapshot } from "./daily-run";

/** Read the recorded run snapshot, or null when no run exists for the id. */
export async function readRunRow(db: CatalogDb, runId: string): Promise<RunSnapshot | null> {
  const rows = (await db.execute(readStatement(runId))).rows;
  if (rows.length === 0) return null;
  return parseRunSnapshot(rows[0]);
}

/** The SELECT of status + reclaim signals for one run id. */
function readStatement(runId: string): SQL {
  return statementBuilder()
    .select({ status: catalogRuns.status, startedAt: catalogRuns.startedAt, publishedVersions: catalogRuns.publishedVersions })
    .from(catalogRuns)
    .where(eq(catalogRuns.runId, runId))
    .getSQL();
}

/** Atomically reserve the run row; false when another invocation owns it. */
export async function beginRunRow(db: CatalogDb, runId: string): Promise<boolean> {
  const rows = (await db.execute(beginStatement(runId))).rows;
  return rows.length > 0;
}

/** INSERT ... ON CONFLICT (run_id) DO UPDATE status running WHERE not already running. */
function beginStatement(runId: string): SQL {
  return statementBuilder()
    .insert(catalogRuns)
    .values({ runId, status: "running", startedAt: nowSql() })
    .onConflictDoUpdate({
      target: catalogRuns.runId,
      set: { status: "running" },
      setWhere: sql`${catalogRuns.status} <> 'running'`,
    })
    .returning({ runId: catalogRuns.runId })
    .getSQL();
}

/** Persist the full snapshot over the run row. */
export async function recordRunRow(db: CatalogDb, runId: string, snapshot: RunSnapshot): Promise<void> {
  await db.execute(recordStatement(runId, snapshot));
}

/** UPDATE the run row with the serialized snapshot. */
function recordStatement(runId: string, snapshot: RunSnapshot): SQL {
  return statementBuilder()
    .update(catalogRuns)
    .set({
      status: snapshot.status,
      targets: snapshot.targets,
      sourceOutcomes: snapshot.sources,
      budgetUsed: {
        workUsed: snapshot.budgetUsed.workUsed,
        requestUsed: snapshot.budgetUsed.requestUsed,
        runtimeUsedMs: snapshot.budgetUsed.runtimeUsedMs,
        firstExhausted: snapshot.firstExhausted,
      },
      failures: snapshot.failures,
      publishedVersions: snapshot.published,
      finishedAt: finishedAtValue(snapshot),
    })
    .where(eq(catalogRuns.runId, runId))
    .getSQL();
}

/** finished_at is set only for terminal states. */
function finishedAtValue(snapshot: RunSnapshot): SQL | null {
  return snapshot.status === "running" || snapshot.status === "pending" ? null : nowSql();
}

/** Mark a run failed with a reason (stale reclaim before a retry re-runs it). */
export async function markRunFailedRow(db: CatalogDb, runId: string, reason: string): Promise<void> {
  await db.execute(failStatement(runId, reason));
}

/** UPDATE the run row to failed with a reclaim marker and a finished timestamp. */
function failStatement(runId: string, reason: string): SQL {
  return statementBuilder()
    .update(catalogRuns)
    .set({
      status: "failed",
      failures: [{ bangumiId: runId, stage: "reclaim", reason }],
      finishedAt: nowSql(),
    })
    .where(eq(catalogRuns.runId, runId))
    .getSQL();
}

/** NOW() — the transition timestamp. */
function nowSql(): SQL {
  return sql`NOW()`;
}

/** Coerce a catalog_runs row into a snapshot for the protocol's read gate. */
function parseRunSnapshot(value: unknown): RunSnapshot | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (typeof status !== "string") return null;
  return {
    status: status as RunSnapshot["status"],
    targets: null,
    sources: {},
    budgetUsed: { workUsed: 0, requestUsed: 0, runtimeUsedMs: 0 },
    firstExhausted: null,
    failures: [],
    published: parsePublished(record.publishedVersions),
    startedAtMs: parseStartedAt(record.startedAt),
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
