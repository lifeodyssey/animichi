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
import type { JsonValue } from "@prisma/orm-postgres/contract/types";
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../db/prisma";
import { atServerNow } from "../db/plans";
import { asJsonValue } from "../lib/json";
import { isUniqueViolation } from "../lib/pg-error";
import type { RunFailure, RunLedgerEntry, RunSnapshot } from "./daily-run";

interface RunRow extends Record<string, unknown> {
  status: string;
  started_at: string | null;
  published_versions: unknown;
  failures: unknown;
}

/** Read the recorded run snapshot, or null when no run exists for the id. */
export async function readRunRow(query: CatalogPrisma, runId: string): Promise<RunSnapshot | null> {
  const rows = await query.executor.query(readPlan(query, runId));
  const [first] = rows;
  return first === undefined ? null : snapshotOf(first);
}

/** The SELECT of status, reclaim signals and the failure ledger for one run id. */
function readPlan(query: CatalogPrisma, runId: string): SqlOrmPlan<RunRow> {
  return query.builder.public.catalog_runs
    .select("status", "started_at", "published_versions", "failures")
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
        firstExhausted: snapshot.firstExhausted,
      },
      failures: recordedLedger(snapshot.failures),
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

/** Mark a stale run failed before a retry re-runs it, recording the ledger the protocol carries. */
export async function markRunFailedRow(query: CatalogPrisma, runId: string, failures: readonly RunLedgerEntry[]): Promise<void> {
  await query.executor.query(failPlan(query, runId, failures));
}

/** UPDATE the run row to failed with its failure ledger and a finished timestamp. */
function failPlan(query: CatalogPrisma, runId: string, failures: readonly RunLedgerEntry[]): SqlOrmPlan {
  const update = query.builder.public.catalog_runs
    .update({ status: "failed", failures: recordedLedger(failures) })
    .where((fields, match) => match.eq(fields.run_id, runId))
    .build();
  return atServerNow(update, ["finished_at"]);
}

/**
 * The ledger as the `failures` column records it: an unrecognised element goes
 * back as the value it was read as. The column is jsonb, so that value keeps no
 * key order or whitespace, and its numbers pass through JavaScript: an integer
 * above 2^53, a `-0` or a `1.0` may not come back as it was written.
 */
function recordedLedger(entries: readonly RunLedgerEntry[]): JsonValue {
  return asJsonValue(entries.map((entry) => ("unrecognised" in entry ? entry.unrecognised : entry)));
}

/** Coerce a catalog_runs row into a snapshot for the protocol's read gate. */
function snapshotOf(row: RunRow): RunSnapshot | null {
  if (typeof row.status !== "string") return null;
  return {
    status: row.status as RunSnapshot["status"],
    targets: null,
    sources: {},
    budgetUsed: { workUsed: 0, requestUsed: 0 },
    firstExhausted: null,
    failures: parseFailures(row.failures),
    published: parsePublished(row.published_versions),
    startedAtMs: parseStartedAt(row.started_at),
  };
}

/** Read the recorded `failures` JSONB back as the run's ledger; a NULL column is an empty one. */
function parseFailures(value: unknown): RunLedgerEntry[] {
  return Array.isArray(value) ? value.map(ledgerEntry) : [];
}

/**
 * One recorded ledger element. A failure in the shape this store writes is read
 * as one, and a reclaim entry is read without the run id an older store wrote
 * into its `bangumiId`, so the next write records the reclaim without it. Any
 * other element is carried unread, to be written back as the value it was read
 * as ({@link recordedLedger} says what that value keeps).
 */
function ledgerEntry(value: unknown): RunLedgerEntry {
  return recognisedFailure(value) ?? { unrecognised: value };
}

/** The failure an element records when it has the shape this store writes; null for anything else. */
function recognisedFailure(value: unknown): RunFailure | null {
  if (!isRecord(value) || !hasOnlyFailureKeys(value) || typeof value.reason !== "string") return null;
  if (value.stage === "reclaim") return { stage: "reclaim", reason: value.reason };
  if (!isWorkStage(value.stage) || typeof value.bangumiId !== "string") return null;
  return { bangumiId: value.bangumiId, stage: value.stage, reason: value.reason };
}

/** The keys a failure this store writes carries; a reclaim's `bangumiId` is the run id an older store put there. */
const FAILURE_KEYS: ReadonlySet<string> = new Set(["bangumiId", "stage", "reason"]);

/** Whether an element carries no key beyond those a failure this store writes carries. */
function hasOnlyFailureKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => FAILURE_KEYS.has(key));
}

/** The stages a work's own failure is recorded at. */
function isWorkStage(value: unknown): value is "fetch" | "enrich" | "quality" {
  return value === "fetch" || value === "enrich" || value === "quality";
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
