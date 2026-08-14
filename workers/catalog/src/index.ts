import { WorkerEntrypoint } from "cloudflare:workers";
import { Hono } from "hono";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { catalogRouter } from "./router";
import type { CatalogDb } from "./db/client";
import { catalogIngestBangumi } from "./ingest/ingest-bangumi";
import type { IngestResult } from "./ingest/ingest-bangumi";
import { DAILY_DISCOVER_CRON, SEED_CRON, TTL_BATCH_CAP, TTL_REFRESH_CRON } from "./cron-config";
import { listDoneBangumiIds, listStaleBangumiIds } from "./ingest/cron-queries";
import { catalogDailyRun } from "./ingest/catalog-daily-run";
import { buildDailyInventory } from "./ingest/daily-discovery";
import { SEED_BANGUMI_IDS, SEED_BANGUMI } from "./ingest/seed-works";
import { serveImage } from "./media/img";

export interface Env {
  ENVIRONMENT?: string;
  /** Optional pooled connection binding when a deployment provides one. */
  HYPERDRIVE?: { connectionString: string };
  /** Neon Postgres connection string used by the current catalog deployment. */
  DATABASE_URL?: string | SecretsStoreSecret;
  /** R2 bucket for lazy-cached pilgrimage point photos (see media/img.ts). */
  MEDIA_BUCKET?: R2Bucket;
}

export const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) =>
  c.json({ status: "ok", service: "catalog", env: c.env.ENVIRONMENT ?? "unknown" }),
);

// Public catalog reads are anonymous and change only on republish — let the edge
// cache them (5 min browser, 1 h edge). Runs before the /catalog/* oRPC handler,
// tagging its response on the way back out.
const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=3600";
app.use("/catalog/public/*", async (c, next) => {
  if (new URL(c.req.url).search) return c.json({ error: "unexpected query parameters" }, 400);
  await next();
  if (c.res.ok) c.res.headers.set("Cache-Control", PUBLIC_CACHE_CONTROL);
});

const apiHandler = new OpenAPIHandler(catalogRouter);

/**
 * Prefer an explicitly provided pooled binding; otherwise use the Neon URL.
 * In staging the DSN arrives as a Secrets Store binding (#912 PR2): the value
 * is a SecretsStoreSecret whose `.get()` resolves the string. The string
 * branch keeps local dev (.dev.vars) and tests working unchanged.
 */
async function connectionString(env?: Env): Promise<string | undefined> {
  if (env?.HYPERDRIVE?.connectionString) return env.HYPERDRIVE.connectionString;
  const url = env?.DATABASE_URL;
  if (url == null) return undefined;
  return typeof url === "string" ? url : await url.get();
}

function waitUntilFor(
  c: { executionCtx: { waitUntil: (p: Promise<unknown>) => void } },
): ((p: Promise<unknown>) => void) | undefined {
  try {
    const ctx = c.executionCtx;
    return ctx.waitUntil.bind(ctx);
  } catch {
    return undefined;
  }
}

interface DbEntry {
  db: CatalogDb;
}

// One client per connection string, reused across requests.
const dbPools = new Map<string, DbEntry>();

async function dbFor(connStr: string): Promise<DbEntry> {
  const cached = dbPools.get(connStr);
  if (cached) return cached;
  const { makeDb } = await import("./db/client");
  const entry: DbEntry = { db: makeDb(connStr) };
  dbPools.set(connStr, entry);
  return entry;
}

/** Clear the cached entries — for test teardown (neon-http is stateless, no sockets to close). */
export function closeDbPools(): void {
  dbPools.clear();
}

app.get("/catalog/img/:pointId", async (c) => {
  const connStr = await connectionString(c.env);
  const bucket = c.env.MEDIA_BUCKET;
  if (!connStr || !bucket) {
    return c.json({ error: "catalog media not configured" }, 503);
  }
  const { db } = await dbFor(connStr);
  return serveImage(
    { db, bucket, fetchImpl: fetch },
    c.req.param("pointId"),
  );
});

app.use("/catalog/*", async (c, next) => {
  const connStr = await connectionString(c.env);
  if (!connStr) {
    return c.json({ error: "catalog database not configured" }, 503);
  }
  const { db } = await dbFor(connStr);
  const { matched, response } = await apiHandler.handle(c.req.raw, {
    context: { db, fetchImpl: fetch, waitUntil: waitUntilFor(c) },
  });
  if (matched) {
    return c.newResponse(response.body, response);
  }
  await next();
});

export { catalogRouter };
export type { CatalogRouter } from "./router";

/**
 * Internal-only ingest door (#540): a named entrypoint reachable exclusively
 * through a Cloudflare service binding — the public oRPC route is gone, so no
 * HTTP surface can reach the ingest pipeline. The search-miss and points-by-id
 * lazy-ingest paths stay internal to this Worker and keep calling the
 * IngestBangumi use case directly.
 */
export class IngestEntrypoint extends WorkerEntrypoint<Env> {
  async ingestBangumi(bangumiId: string): Promise<IngestResult> {
    const connStr = await connectionString(this.env);
    if (!connStr) throw new Error("catalog database not configured");
    const { db } = await dbFor(connStr);
    return catalogIngestBangumi(db).ingest(bangumiId);
  }
}

// ---------------------------------------------------------------------------
// Scheduled ingestion (S0-v2 D4) — Cron Triggers. Fail-closed cron-string
// dispatcher with injectable dependencies, tested with a fake controller/DB
// in the worker pool (the jobs Worker's retired dispatcher was the template).
// Schedule constants live in src/cron-config.ts (the entry module must not
// export primitives — workerd rejects them at boot).
// ---------------------------------------------------------------------------

interface ScheduledInput {
  readonly cron: string;
}

type ScheduledEnvironment = Partial<Env>;
type ScheduledHandler = (
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
  runDailyIngest: (db: CatalogDb) => Promise<unknown>;
}

const DEFAULT_DEPENDENCIES: CronDependencies = {
  connect: async (connStr) => (await dbFor(connStr)).db,
  ingestBangumi: (db, bangumiId) => catalogIngestBangumi(db).ingest(bangumiId),
  listDoneBangumiIds,
  listStaleBangumiIds,
  runDailyIngest: (db) => runDailyJob(db),
};

export function createScheduledHandler(
  dependencies: CronDependencies = DEFAULT_DEPENDENCIES,
): ScheduledHandler {
  return async (controller, env) => {
    const connStr = await connectionString(env);
    if (!connStr) throw new Error("catalog database not configured");
    const db = await dependencies.connect(connStr);
    await runCron(controller.cron, db, dependencies);
  };
}

async function runCron(
  cron: string,
  db: CatalogDb,
  dependencies: CronDependencies,
): Promise<CronJobResult> {
  if (cron === SEED_CRON) return runSeedJob(db, dependencies);
  if (cron === TTL_REFRESH_CRON) return runTtlJob(db, dependencies);
  if (cron === DAILY_DISCOVER_CRON) {
    await dependencies.runDailyIngest(db);
    return { attempted: 0, ingested: 0, skipped: 0 };
  }
  throw new Error(`Unknown catalog cron: ${cron}`);
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

/** The production daily discovery + ingest run (#1006). */
export async function runDailyJob(db: CatalogDb): Promise<unknown> {
  const inventory = await buildDailyInventory(db);
  return catalogDailyRun(db, Date.now(), inventory, dailyPolicy());
}

/** Production budget/tier policy for the daily run (operational config, not magic). */
function dailyPolicy() {
  return {
    staleRunningMs: 6 * 60 * 60 * 1000,
    tierIntervals: { high: 24 * 60 * 60 * 1000, medium: 7 * 24 * 60 * 60 * 1000, low: 30 * 24 * 60 * 60 * 1000 },
    newWorkCap: 20,
    keepHistory: 2,
    budget: { workLimit: 50, requestLimit: 400, runtimeLimitMs: 10 * 60 * 1000 },
  };
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

/** One work's ingest, throwing-free — a failure counts as skipped, the batch continues. */
async function ingestOne(
  db: CatalogDb,
  dependencies: CronDependencies,
  bangumiId: string,
): Promise<boolean> {
  try {
    return (await dependencies.ingestBangumi(db, bangumiId)).status === "ingested";
  } catch (err) {
    console.error(`[cron] ingest failed for work ${bangumiId}: ${String(err)}`);
    return false;
  }
}

export default {
  fetch: app.fetch,
  scheduled: createScheduledHandler(),
} satisfies ExportedHandler<Env>;
