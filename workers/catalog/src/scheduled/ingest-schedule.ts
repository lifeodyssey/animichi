/**
 * Scheduled-ingestion DISPATCHER (S0-v2 D4 + #1016 per-env schedules).
 *
 * Decides which job a cron event is, acquires the pass's seams, and applies the
 * per-environment AC1 guard (production owns upstream ingest, staging owns
 * import, and both deployed environments drain pending work). What each job
 * then DOES lives in `./cron-jobs`; kept out of the Worker entry so the
 * composition root stays a slim list of mounts and entrypoint exports.
 *
 * Each pass arms its deadline (`CRON_PASS_DEADLINE_MS`) the moment it starts and
 * hands that signal, with the egress signing key, to every job: it aborts the
 * upstream requests in flight and stops a batch before Cloudflare's 15-minute
 * limit would cut the pass off mid-write.
 */
import { connectionString } from "../db/connections";
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
import { CRON_PASS_DEADLINE_MS } from "../cron-config";
import type { UpstreamAccess } from "../ingest/sources";
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

/**
 * Outcome of one cron pass. Every attempted work lands in exactly one count, so
 * `ingested + skipped + failed = attempted`: `skipped` is a work with nothing
 * for this pass to ingest (another invocation holds it or took its claim over,
 * its last failure is still parked, or upstream has no points for it), and
 * `failed` is an ingest that failed or threw.
 */
export interface CronJobResult {
  readonly attempted: number;
  readonly ingested: number;
  readonly skipped: number;
  readonly failed: number;
}

/** The summary of a pass that ran no ingest batch: denied, or a daily publish or import. */
const NO_BATCH: CronJobResult = { attempted: 0, ingested: 0, skipped: 0, failed: 0 };

/**
 * Injectable seams for the cron jobs; tests substitute every one.
 *
 * Every job takes the pass's {@link CatalogPrisma} (#1630, #1633) — the staging
 * import was the last one on a seam of its own, and joined this one when the
 * Drizzle client left the repository.
 */
export interface CronDependencies {
  /** Acquire this cron pass's Prisma seam; the handler disposes it when done. */
  connectPrisma: (connectionString: string) => Promise<CronPrisma>;
  ingestBangumi: (query: CatalogPrisma, bangumiId: string, upstream: UpstreamAccess) => Promise<IngestResult>;
  listDoneBangumiIds: (query: CatalogPrisma, bangumiIds: readonly string[]) => Promise<ReadonlySet<string>>;
  listDrainableBangumiIds: (query: CatalogPrisma, cap: number) => Promise<readonly string[]>;
  listStaleBangumiIds: (query: CatalogPrisma, cap: number) => Promise<readonly string[]>;
  runDailyIngest: (query: CatalogPrisma, upstream: UpstreamAccess) => Promise<DailyRunOutcome>;
  snapshotStore: (bucket: R2Bucket | undefined) => ObjectStore | null;
  publishRun: (query: CatalogPrisma, store: ObjectStore, sourceRunId: string, createdAt: string) => Promise<PublishResult>;
  gcSnapshots: (store: ObjectStore) => Promise<GcResult>;
  /** Build the read-only snapshot source, or null when no import binding exists (AC2). */
  importSource: (env: ScheduledEnvironment) => SnapshotSource | null;
  /** Run the daily staging import over the pass's seam (AC1/AC3/AC4). */
  runImport: (query: CatalogPrisma, source: SnapshotSource | null) => Promise<ImportResult>;
}

/** One work's ingest on a cron pass: the production `IngestBangumi`, under the pass's upstream access. */
export function ingestOnPass(query: CatalogPrisma, bangumiId: string, upstream: UpstreamAccess): Promise<IngestResult> {
  return catalogIngestBangumi(query, upstream.egressSigningKey).ingest(bangumiId, { signal: upstream.signal });
}

const DEFAULT_DEPENDENCIES: CronDependencies = {
  connectPrisma: defaultCronPrisma,
  ingestBangumi: ingestOnPass,
  listDoneBangumiIds,
  listDrainableBangumiIds,
  listStaleBangumiIds,
  runDailyIngest: (query, upstream) => runDailyJob(query, upstream),
  snapshotStore: (bucket) => (bucket ? r2ObjectStore(bucket) : null),
  publishRun: (query, store, sourceRunId, createdAt) => publishSnapshot({ query, store }, { sourceRunId, createdAt }),
  gcSnapshots: (store) => gcSnapshots(store, SNAPSHOT_KEEP),
  importSource: (env) => snapshotSourceFor(env),
  runImport: (query, source) => runImportJob(query, source),
};

export function createScheduledHandler(
  dependencies: CronDependencies = DEFAULT_DEPENDENCIES,
): ScheduledHandler {
  return async (controller, env) => {
    const deadline = AbortSignal.timeout(CRON_PASS_DEADLINE_MS);
    const connStr = await connectionString(env);
    if (!connStr) throw new Error("catalog database not configured");
    const kind = cronKind(controller.cron);
    if (kind === "unknown") throw new Error("Unknown catalog cron: " + controller.cron);
    if (guardCron(kind, runtimeEnvironment(env.ENVIRONMENT)).denied) {
      logCronCompletion(kind, NO_BATCH);
      return;
    }
    const store = dependencies.snapshotStore(env.SNAPSHOT_BUCKET);
    const source = dependencies.importSource(env);
    const upstream = { egressSigningKey: await egressSigningKeyFromEnv(env), signal: deadline };
    const context: CronContext = { store, importSource: source, upstream };
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
  /** The egress signing key and the pass's deadline signal, handed to every upstream call. */
  readonly upstream: UpstreamAccess;
}

/** Every cron run leaves an "it finished, here's what it did" signal. */
function logCronCompletion(kind: CronKind, result: CronJobResult): void {
  console.log(
    `${kind} cron: attempted=${String(result.attempted)} ingested=${String(result.ingested)}`
      + ` skipped=${String(result.skipped)} failed=${String(result.failed)}`,
  );
}

/**
 * Run one cron pass on the ONE runtime its kind needs, disposed on scope exit.
 *
 * `dailyDiscover` runs its ingest AND its snapshot publish on that seam, and
 * since #1633 `dailyImport` takes it too: the staging import was the last job
 * with a client of its own, and it had one only because it still wrote the
 * pre-Prisma column set.
 */
async function runCron(
  kind: ScheduledCronKind,
  connStr: string,
  dependencies: CronDependencies,
  context: CronContext,
): Promise<CronJobResult> {
  const seam = await dependencies.connectPrisma(connStr);
  try {
    return await runCronKind(kind, seam.query, dependencies, context);
  } finally {
    await seam.dispose();
  }
}

/** The pass itself, once its seam is open: the two publishing kinds, then ingest. */
async function runCronKind(
  kind: ScheduledCronKind,
  query: CatalogPrisma,
  dependencies: CronDependencies,
  context: CronContext,
): Promise<CronJobResult> {
  if (kind === "dailyImport") {
    await runDailyImport(query, dependencies, context.importSource);
    return NO_BATCH;
  }
  if (kind === "dailyDiscover") {
    await publishDailyDiscover(query, dependencies, context);
    return NO_BATCH;
  }
  return runIngestKind(kind, query, dependencies, context.upstream);
}

/** The three kinds that only ever run ingest batches. */
function runIngestKind(
  kind: Exclude<CronKind, "unknown" | "dailyDiscover" | "dailyImport">,
  query: CatalogPrisma,
  dependencies: CronDependencies,
  upstream: UpstreamAccess,
): Promise<CronJobResult> {
  if (kind === "seed") return runSeedJob(query, dependencies, upstream);
  if (kind === "ttl") return runProductionHourlyJob(query, dependencies, upstream);
  return runPendingDrainJob(query, dependencies, undefined, upstream);
}

/** The daily run, then the snapshot publish, both on this pass's one seam. */
async function publishDailyDiscover(
  query: CatalogPrisma,
  dependencies: CronDependencies,
  context: CronContext,
): Promise<void> {
  await publishAfterRun(context.store, {
    runDailyIngest: () => dependencies.runDailyIngest(query, context.upstream),
    publishRun: (store, sourceRunId, createdAt) => dependencies.publishRun(query, store, sourceRunId, createdAt),
    gcSnapshots: (store) => dependencies.gcSnapshots(store),
  });
}

/** Production reuses the existing hourly event: durable intent first, TTL second. */
async function runProductionHourlyJob(
  query: CatalogPrisma,
  dependencies: CronDependencies,
  upstream: UpstreamAccess,
): Promise<CronJobResult> {
  const budget = new Budget(hourlyIngestBudget());
  const pending = await runPendingDrainJob(query, dependencies, budget, upstream);
  const stale = await runTtlJob(query, dependencies, budget, upstream);
  return combineResults(pending, stale);
}

function combineResults(left: CronJobResult, right: CronJobResult): CronJobResult {
  return {
    attempted: left.attempted + right.attempted,
    ingested: left.ingested + right.ingested,
    skipped: left.skipped + right.skipped,
    failed: left.failed + right.failed,
  };
}

/** The daily staging import's own result never carried a batch count
 * (`CronJobResult` above stays zeroed for it); log its outcome directly so a
 * validation/activation failure is not a silent no-op. */
async function runDailyImport(
  query: CatalogPrisma,
  dependencies: CronDependencies,
  importSource: SnapshotSource | null,
): Promise<void> {
  logImportOutcome(await dependencies.runImport(query, importSource));
}

/** The import's own failure reason is the signal; success logs the snapshot id. */
function logImportOutcome(result: ImportResult): void {
  if (result.status === "invalid") {
    console.error("[dailyImport] " + result.reason);
    return;
  }
  console.log("[dailyImport] imported snapshot " + result.snapshotId);
}
