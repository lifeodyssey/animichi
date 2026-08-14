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

/** The SELECT of status for one run id. */
function readStatement(runId: string): SQL {
  return statementBuilder()
    .select({ status: catalogRuns.status })
    .from(catalogRuns)
    .where(eq(catalogRuns.runId, runId))
    .getSQL();
}

/** Reserve the run row atomically; a retry that already holds it is a no-op. */
export async function beginRunRow(db: CatalogDb, runId: string): Promise<void> {
  await db.execute(beginStatement(runId));
}

/** INSERT ... ON CONFLICT (run_id) DO NOTHING, status running. */
function beginStatement(runId: string): SQL {
  return statementBuilder()
    .insert(catalogRuns)
    .values({ runId, status: "running", startedAt: nowSql() })
    .onConflictDoNothing()
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
      targets: json(snapshot.targets),
      sourceOutcomes: json(snapshot.sources),
      budgetUsed: json({
        workUsed: snapshot.budgetUsed.workUsed,
        requestUsed: snapshot.budgetUsed.requestUsed,
        runtimeUsedMs: snapshot.budgetUsed.runtimeUsedMs,
        firstExhausted: snapshot.firstExhausted,
      }),
      failures: json(snapshot.failures),
      publishedVersions: json(snapshot.published),
      finishedAt: finishedAtValue(snapshot),
    })
    .where(eq(catalogRuns.runId, runId))
    .getSQL();
}

/** finished_at is set only for terminal states. */
function finishedAtValue(snapshot: RunSnapshot): SQL | null {
  return snapshot.status === "running" || snapshot.status === "pending" ? null : nowSql();
}

/** NOW() — the transition timestamp. */
function nowSql(): SQL {
  return sql`NOW()`;
}

/** JSON.stringify a value for a jsonb bind. */
function json(value: unknown): string {
  return JSON.stringify(value);
}

/** Coerce a catalog_runs row into a snapshot; only status is needed for reads. */
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
    published: {},
  };
}
