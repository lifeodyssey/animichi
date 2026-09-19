/**
 * Scheduled-ingestion DISPATCHER (S0-v2 D4 + #1016 per-env schedules).
 *
 * Decides which job a cron event is, acquires the pass's seams, and applies the
 * per-environment AC1 guard (production owns upstream ingest, staging owns
 * import, and both deployed environments drain pending work). What each job
 * then DOES lives in `./cron-jobs`; kept out of the Worker entry so the
 * composition root stays a slim list of mounts and entrypoint exports.
 */
import type { CatalogDb } from "../db/client";
import { connectionString, dbFor } from "../db/connections";
import { acquireCatalogRuntime, catalogPrisma, type CatalogPrisma } from "../db/prisma";
import { catalogIngestBangumi } from "../ingest/ingest-bangumi";
import type { IngestResult } from "../ingest/ingest-bangumi";
import { egressSigningKeyFromEnv } from "../ingest/anitabi-egress";
import { listDoneBangumiIds, listDrainableBangumiIds, listStaleBangumiIds } from "../ingest/cron-queries";
import { Budget } from "../ingest/budgets";
import type { ObjectStore } from "../publish/object-store";
import { r2ObjectStore } from "../publish/object-store";
import { publishSnapshot, type PublishResult } from "../publish/snapshot";
import { gcSnapshots, type GcResult } from "../publish/snapshot-gc";
import { publishAfterRun, type DailyRunOutcome } from "../publish/daily-snapshot";
import { snapshotSourceFor, type SnapshotSource } from "../import/snapshot-source";
import { cronKind, guardCron, runImportJob, type CronKind } from "../import/schedule";
import type { ImportResult } from "../import/import-snapshot";
import { hourlyIngestBudget, runtimeEnvironment } from "../operational-config";
import type { Env } from "../index";
import {
  SNAPSHOT_KEEP,
  runDailyJob,
  runPendingDrainJob,
  runSeedJob,
  runTtlJob,
} from "./cron-jobs";

interface ScheduledInput {
  readonly cron: string;
}

export type ScheduledEnvironment = Partial<Env>;
export type ScheduledHandler = (
  controller: ScheduledInput,
  env: ScheduledEnvironment,
) => Promise<void>;

/** Outcome of one cron pass; `skipped` covers non-ingested and errored works. */
export interface CronJobResult {
  readonly attempted: number;
  readonly ingested: number;
  readonly skipped: number;
}

/**
 * Injectable seams for the cron jobs; tests substitute every one.
 *
 * The ingest path takes the request's {@link CatalogPrisma} (#1630) and the
 * still-Drizzle snapshot/import path takes a {@link CatalogDb}: the migration is
 * mid-flight, and naming both here is what keeps a seam from silently becoming
 * the other one's type.
 */
export interface CronDependencies {
  /** Acquire this cron pass's Prisma seam; the handler disposes it when done. */
  connectPrisma: (connectionString: string) => Promise<CronPrisma>;
  /** The still-Drizzle seam, for the snapshot publish and the staging import. */
  connect: (connectionString: string) => Promise<CatalogDb>;
  ingestBangumi: (query: CatalogPrisma, bangumiId: string, egressSigningKey?: string) => Promise<IngestResult>;
  listDoneBangumiIds: (query: CatalogPrisma, bangumiIds: readonly string[]) => Promise<ReadonlySet<string>>;
  listDrainableBangumiIds: (query: CatalogPrisma, cap: number) => Promise<readonly string[]>;
  listStaleBangumiIds: (query: CatalogPrisma, cap: number) => Promise<readonly string[]>;
  runDailyIngest: (query: CatalogPrisma, egressSigningKey?: string) => Promise<DailyRunOutcome>;
  snapshotStore: (bucket: R2Bucket | undefined) => ObjectStore | null;
  publishRun: (db: CatalogDb, store: ObjectStore, sourceRunId: string, createdAt: string) => Promise<PublishResult>;
  gcSnapshots: (store: ObjectStore) => Promise<GcResult>;
  /** Build the read-only snapshot source, or null when no import binding exists (AC2). */
  importSource: (env: ScheduledEnvironment) => SnapshotSource | null;
  /** Run the daily staging import over the catalog db (AC1/AC3/AC4). */
  runImport: (db: CatalogDb, source: SnapshotSource | null) => Promise<ImportResult>;
}

const DEFAULT_DEPENDENCIES: CronDependencies = {
  connectPrisma: defaultCronPrisma,
  connect: async (connStr) => (await dbFor(connStr)).db,
  ingestBangumi: (query, bangumiId, egressSigningKey) => catalogIngestBangumi(query, egressSigningKey).ingest(bangumiId),
  listDoneBangumiIds,
  listDrainableBangumiIds,
  listStaleBangumiIds,
  runDailyIngest: (query, egressSigningKey) => runDailyJob(query, egressSigningKey),
  snapshotStore: (bucket) => (bucket ? r2ObjectStore(bucket) : null),
  publishRun: (db, store, sourceRunId, createdAt) => publishSnapshot({ db, store }, { sourceRunId, createdAt }),
  gcSnapshots: (store) => gcSnapshots(store, SNAPSHOT_KEEP),
  importSource: (env) => snapshotSourceFor(env),
  runImport: (db, source) => runImportJob(db, source),
};

export function createScheduledHandler(
  dependencies: CronDependencies = DEFAULT_DEPENDENCIES,
): ScheduledHandler {
  return async (controller, env) => {
    const connStr = await connectionString(env);
    if (!connStr) throw new Error("catalog database not configured");
    const kind = cronKind(controller.cron);
    if (kind === "unknown") throw new Error("Unknown catalog cron: " + controller.cron);
    if (guardCron(kind, runtimeEnvironment(env.ENVIRONMENT)).denied) {
      logCronCompletion(kind, { attempted: 0, ingested: 0, skipped: 0 });
      return;
    }
    const store = dependencies.snapshotStore(env.SNAPSHOT_BUCKET);
    const source = dependencies.importSource(env);
    const egressSigningKey = await egressSigningKeyFromEnv(env);
    const context: CronContext = { store, importSource: source, egressSigningKey };
    const result = await runCron(kind, connStr, dependencies, context);
    logCronCompletion(kind, result);
  };
}

/** The cron kinds that survive `cronKind`'s "unknown" arm. */
type ScheduledCronKind = Exclude<CronKind, "unknown">;

/** This cron pass's Prisma seam, plus the disposal that gives its connection back. */
export interface CronPrisma {
  readonly query: CatalogPrisma;
  dispose(): Promise<void>;
}

/** The production seam: one runtime, disposed when the pass ends. */
async function defaultCronPrisma(connStr: string): Promise<CronPrisma> {
  const runtime = await acquireCatalogRuntime(connStr);
  return {
    query: catalogPrisma(runtime),
    dispose: async () => { await runtime[Symbol.asyncDispose](); },
  };
}

/** What one cron pass resolved from the environment before it starts. */
interface CronContext {
  readonly store: ObjectStore | null;
  readonly importSource: SnapshotSource | null;
  readonly egressSigningKey?: string;
}

/** Every cron run leaves an "it finished, here's what it did" signal. */
function logCronCompletion(kind: CronKind, result: CronJobResult): void {
  console.log(
    `${kind} cron: attempted=${String(result.attempted)} ingested=${String(result.ingested)} skipped=${String(result.skipped)}`,
  );
}

/**
 * Run one cron pass over the seams its kind actually uses.
 *
 * The ingest kinds acquire ONE Prisma runtime for the whole pass, disposed on
 * scope exit. Only `dailyDiscover` also takes the Drizzle handle, because it
 * runs the ingest and then publishes the immutable snapshot — two paths that are
 * on different seams while the migration is mid-flight. Acquiring both for every
 * kind would open a Postgres connection for a cron that never issues a plan.
 */
async function runCron(
  kind: ScheduledCronKind,
  connStr: string,
  dependencies: CronDependencies,
  context: CronContext,
): Promise<CronJobResult> {
  if (kind === "dailyImport") {
    await runDailyImport(await dependencies.connect(connStr), dependencies, context.importSource);
    return { attempted: 0, ingested: 0, skipped: 0 };
  }
  const seam = await dependencies.connectPrisma(connStr);
  try {
    if (kind === "dailyDiscover") {
      await publishDailyDiscover(seam.query, await dependencies.connect(connStr), dependencies, context);
      return { attempted: 0, ingested: 0, skipped: 0 };
    }
    return await runIngestKind(kind, seam.query, dependencies, context.egressSigningKey);
  } finally {
    await seam.dispose();
  }
}

/** The three kinds that only ever run ingest batches. */
function runIngestKind(
  kind: Exclude<CronKind, "unknown" | "dailyDiscover" | "dailyImport">,
  query: CatalogPrisma,
  dependencies: CronDependencies,
  egressSigningKey?: string,
): Promise<CronJobResult> {
  if (kind === "seed") return runSeedJob(query, dependencies, egressSigningKey);
  if (kind === "ttl") return runProductionHourlyJob(query, dependencies, egressSigningKey);
  return runPendingDrainJob(query, dependencies, undefined, egressSigningKey);
}

/** The daily run, then the snapshot publish — each on its own seam. */
async function publishDailyDiscover(
  query: CatalogPrisma,
  db: CatalogDb,
  dependencies: CronDependencies,
  context: CronContext,
): Promise<void> {
  await publishAfterRun(context.store, {
    runDailyIngest: () => dependencies.runDailyIngest(query, context.egressSigningKey),
    publishRun: (store, sourceRunId, createdAt) => dependencies.publishRun(db, store, sourceRunId, createdAt),
    gcSnapshots: (store) => dependencies.gcSnapshots(store),
  });
}

/** Production reuses the existing hourly event: durable intent first, TTL second. */
async function runProductionHourlyJob(
  query: CatalogPrisma,
  dependencies: CronDependencies,
  egressSigningKey?: string,
): Promise<CronJobResult> {
  const budget = new Budget(hourlyIngestBudget());
  const pending = await runPendingDrainJob(query, dependencies, budget, egressSigningKey);
  const stale = await runTtlJob(query, dependencies, budget, egressSigningKey);
  return combineResults(pending, stale);
}

function combineResults(left: CronJobResult, right: CronJobResult): CronJobResult {
  return {
    attempted: left.attempted + right.attempted,
    ingested: left.ingested + right.ingested,
    skipped: left.skipped + right.skipped,
  };
}

/** The daily staging import's own result never carried a batch count
 * (`CronJobResult` above stays zeroed for it); log its outcome directly so a
 * validation/activation failure is not a silent no-op. */
async function runDailyImport(
  db: CatalogDb,
  dependencies: CronDependencies,
  importSource: SnapshotSource | null,
): Promise<void> {
  logImportOutcome(await dependencies.runImport(db, importSource));
}

/** The import's own failure reason is the signal; success logs the snapshot id. */
function logImportOutcome(result: ImportResult): void {
  if (result.status === "invalid") {
    console.error("[dailyImport] " + result.reason);
    return;
  }
  console.log("[dailyImport] imported snapshot " + result.snapshotId);
}
