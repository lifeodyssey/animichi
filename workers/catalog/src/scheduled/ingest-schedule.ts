/**
 * Scheduled-ingestion runtime (S0-v2 D4 + #1016 per-env schedules).
 *
 * Owns the cron dispatcher and the seed / TTL / daily-inventory job runners,
 * plus the per-environment AC1 guard (ingest crons run only in production; the
 * staging import cron runs only in staging). Kept out of the Worker entry so
 * the composition root stays a slim list of mounts and entrypoint exports.
 */
import type { CatalogDb } from "../db/client";
import { connectionString, dbFor } from "../db/connections";
import { catalogIngestBangumi } from "../ingest/ingest-bangumi";
import type { IngestResult } from "../ingest/ingest-bangumi";
import { TTL_BATCH_CAP } from "../cron-config";
import { listDoneBangumiIds, listStaleBangumiIds } from "../ingest/cron-queries";
import { catalogDailyRun } from "../ingest/catalog-daily-run";
import { buildDailyInventory, type SeasonalResolver } from "../ingest/daily-discovery";
import { fetchCurrentSeason } from "../ingest/season";
import type { SourceConfig } from "../ingest/sources";
import { SEED_BANGUMI, SEED_BANGUMI_IDS } from "../ingest/seed-works";
import type { ObjectStore } from "../publish/object-store";
import { r2ObjectStore } from "../publish/object-store";
import { publishSnapshot, type PublishResult } from "../publish/snapshot";
import { gcSnapshots, type GcResult } from "../publish/snapshot-gc";
import { publishAfterRun, type DailyRunOutcome } from "../publish/daily-snapshot";
import { snapshotSourceFor, type SnapshotSource } from "../import/snapshot-source";
import { cronKind, guardCron, runImportJob } from "../import/schedule";
import type { ImportResult } from "../import/import-snapshot";
import { dailyPolicy, runtimeEnvironment, type RuntimeEnvironment } from "../operational-config";
import type { Env } from "../index";

/** The injected snapshot pool keeps N (active) and N-1 (predecessor). */
export const SNAPSHOT_KEEP = 2;

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

/** Injectable seams for the cron jobs; tests substitute every one. */
export interface CronDependencies {
  connect: (connectionString: string) => Promise<CatalogDb>;
  ingestBangumi: (db: CatalogDb, bangumiId: string) => Promise<IngestResult>;
  listDoneBangumiIds: (db: CatalogDb, bangumiIds: readonly string[]) => Promise<ReadonlySet<string>>;
  listStaleBangumiIds: (db: CatalogDb, cap: number) => Promise<readonly string[]>;
  runDailyIngest: (db: CatalogDb, store: ObjectStore | null) => Promise<DailyRunOutcome>;
  snapshotStore: (bucket: R2Bucket | undefined) => ObjectStore | null;
  publishRun: (db: CatalogDb, store: ObjectStore, sourceRunId: string, createdAt: string) => Promise<PublishResult>;
  gcSnapshots: (store: ObjectStore) => Promise<GcResult>;
  /** Build the read-only snapshot source, or null when no import binding exists (AC2). */
  importSource: (env: ScheduledEnvironment) => SnapshotSource | null;
  /** Run the daily staging import over the catalog db (AC1/AC3/AC4). */
  runImport: (db: CatalogDb, source: SnapshotSource | null) => Promise<ImportResult>;
}

const DEFAULT_DEPENDENCIES: CronDependencies = {
  connect: async (connStr) => (await dbFor(connStr)).db,
  ingestBangumi: (db, bangumiId) => catalogIngestBangumi(db).ingest(bangumiId),
  listDoneBangumiIds,
  listStaleBangumiIds,
  runDailyIngest: (db) => runDailyJob(db),
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
    const db = await dependencies.connect(connStr);
    const store = dependencies.snapshotStore(env.SNAPSHOT_BUCKET);
    const environment = runtimeEnvironment(env.ENVIRONMENT);
    const source = dependencies.importSource(env);
    await runCron(controller.cron, db, dependencies, store, environment, source);
  };
}

async function runCron(
  cron: string,
  db: CatalogDb,
  dependencies: CronDependencies,
  store: ObjectStore | null,
  environment: RuntimeEnvironment,
  importSource: SnapshotSource | null,
): Promise<CronJobResult> {
  const kind = cronKind(cron);
  if (kind === "unknown") throw new Error("Unknown catalog cron: " + cron);
  if (guardCron(kind, environment).denied) return { attempted: 0, ingested: 0, skipped: 0 };
  switch (kind) {
    case "seed":
      return runSeedJob(db, dependencies);
    case "ttl":
      return runTtlJob(db, dependencies);
    case "dailyDiscover":
      await publishAfterRun(db, store, dependencies);
      return { attempted: 0, ingested: 0, skipped: 0 };
    case "dailyImport":
      await dependencies.runImport(db, importSource);
      return { attempted: 0, ingested: 0, skipped: 0 };
  }
}

/** Seed pass: ingest the checked-in titles that have no `done` ingest_jobs row. */
export async function runSeedJob(
  db: CatalogDb,
  dependencies: CronDependencies,
): Promise<CronJobResult> {
  const done = await dependencies.listDoneBangumiIds(db, SEED_BANGUMI_IDS);
  const pending = SEED_BANGUMI.filter((title) => !done.has(title.bangumiId)).map(
    (title) => title.bangumiId,
  );
  return ingestBatch(db, dependencies, pending);
}

/** TTL pass: re-ingest the stalest raw works, one at a time, capped per run. */
export async function runTtlJob(
  db: CatalogDb,
  dependencies: CronDependencies,
): Promise<CronJobResult> {
  const stale = await dependencies.listStaleBangumiIds(db, TTL_BATCH_CAP);
  return ingestBatch(db, dependencies, stale.slice(0, TTL_BATCH_CAP));
}

/** The production daily discovery + ingest run (#1006). Returns the run status. */
export async function runDailyJob(
  db: CatalogDb,
  seasonalResolver: SeasonalResolver = bangumiSeasonResolver(),
): Promise<DailyRunOutcome> {
  const inventory = await buildDailyInventory(db, seasonalResolver);
  return catalogDailyRun(db, Date.now(), inventory, dailyPolicy());
}

/**
 * The production current-season resolver: the Bangumi calendar week, fetched
 * through the shared injectable source config (defaults to the real HTTP).
 * An upstream outage degrades to an empty season so popularity + historical
 * discovery still feed the run rather than aborting it.
 */
export function bangumiSeasonResolver(cfg: SourceConfig = {}): SeasonalResolver {
  return () => fetchCurrentSeason(cfg).catch(seasonFallback);
}

/** A failed season fetch logs and yields no season ids (never aborts the run). */
function seasonFallback(error: unknown): readonly string[] {
  console.error("[daily] current-season fetch failed: " + String(error));
  return [];
}

/** Sequential per-work ingest; one failure never aborts the rest of the batch. */
async function ingestBatch(
  db: CatalogDb,
  dependencies: CronDependencies,
  bangumiIds: readonly string[],
): Promise<CronJobResult> {
  let ingested = 0;
  for (const bangumiId of bangumiIds) {
    if (await ingestOne(db, dependencies, bangumiId)) ingested++;
  }
  return { attempted: bangumiIds.length, ingested, skipped: bangumiIds.length - ingested };
}

/** One work's ingest, throwing-free — a failure counts as skipped. */
async function ingestOne(
  db: CatalogDb,
  dependencies: CronDependencies,
  bangumiId: string,
): Promise<boolean> {
  try {
    return (await dependencies.ingestBangumi(db, bangumiId)).status === "ingested";
  } catch (err) {
    console.error("[cron] ingest failed for work " + bangumiId + ": " + String(err));
    return false;
  }
}
