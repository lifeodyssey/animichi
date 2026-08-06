import { WorkerEntrypoint } from "cloudflare:workers";
import { Hono } from "hono";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { catalogRouter } from "./router";
import type { CatalogDb, NeonSql } from "./db/client";
import { ingestWork as runOrchestratorIngest } from "./ingest/orchestrator";
import type { IngestResult as OrchestratorIngestResult } from "./ingest/orchestrator";
import { SEED_CRON, TTL_BATCH_CAP, TTL_REFRESH_CRON } from "./cron-config";
import { listDoneWorkIds, listStaleWorkIds } from "./ingest/cron-queries";
import { SEED_WORK_IDS, SEED_WORKS } from "./ingest/seed-works";
import { serveImage } from "./media/img";

export interface Env {
  ENVIRONMENT?: string;
  /** Optional pooled connection binding when a deployment provides one. */
  HYPERDRIVE?: { connectionString: string };
  /** Neon Postgres connection string used by the current catalog deployment. */
  DATABASE_URL?: string;
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

/** Prefer an explicitly provided pooled binding; otherwise use the Neon URL. */
function connectionString(env?: Env): string | undefined {
  return env?.HYPERDRIVE?.connectionString ?? env?.DATABASE_URL;
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
  neonSql: NeonSql;
}

// One client pair per connection string, reused across requests.
const dbPools = new Map<string, DbEntry>();

async function dbFor(connStr: string): Promise<DbEntry> {
  const cached = dbPools.get(connStr);
  if (cached) return cached;
  const { makeDb, makeNeonSql } = await import("./db/client");
  const entry: DbEntry = { db: makeDb(connStr), neonSql: makeNeonSql(connStr) };
  dbPools.set(connStr, entry);
  return entry;
}

/** Clear the cached entries — for test teardown (neon-http is stateless, no sockets to close). */
export function closeDbPools(): void {
  dbPools.clear();
}

app.get("/catalog/img/:pointId", async (c) => {
  const connStr = connectionString(c.env);
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
  const connStr = connectionString(c.env);
  if (!connStr) {
    return c.json({ error: "catalog database not configured" }, 503);
  }
  const { db, neonSql } = await dbFor(connStr);
  const { matched, response } = await apiHandler.handle(c.req.raw, {
    context: { db, neonSql, fetchImpl: fetch, waitUntil: waitUntilFor(c) },
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
 * HTTP surface can reach the orchestrator. The search-miss and work-points
 * lazy-ingest paths stay internal to this Worker and keep calling the
 * orchestrator directly.
 */
export class IngestEntrypoint extends WorkerEntrypoint<Env> {
  async ingestWork(workId: string): Promise<OrchestratorIngestResult> {
    const connStr = connectionString(this.env);
    if (!connStr) throw new Error("catalog database not configured");
    const { db } = await dbFor(connStr);
    return runOrchestratorIngest(db, workId);
  }
}

// ---------------------------------------------------------------------------
// Scheduled ingestion (S0-v2 D4) — Cron Triggers. Shape mirrors
// workers/jobs/src/index.ts: a fail-closed cron-string dispatcher with
// injectable dependencies, tested with a fake controller/DB in the worker pool.
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
  ingestWork: (db: CatalogDb, workId: string) => Promise<OrchestratorIngestResult>;
  listDoneWorkIds: (db: CatalogDb, workIds: readonly string[]) => Promise<ReadonlySet<string>>;
  listStaleWorkIds: (db: CatalogDb, cap: number) => Promise<readonly string[]>;
}

const DEFAULT_DEPENDENCIES: CronDependencies = {
  connect: async (connStr) => (await dbFor(connStr)).db,
  ingestWork: runOrchestratorIngest,
  listDoneWorkIds,
  listStaleWorkIds,
};

export function createScheduledHandler(
  dependencies: CronDependencies = DEFAULT_DEPENDENCIES,
): ScheduledHandler {
  return async (controller, env) => {
    const connStr = connectionString(env);
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
  throw new Error(`Unknown catalog cron: ${cron}`);
}

/** Seed pass: ingest the checked-in works that have no `done` ingest_jobs row. */
export async function runSeedJob(
  db: CatalogDb,
  dependencies: CronDependencies,
): Promise<CronJobResult> {
  const done = await dependencies.listDoneWorkIds(db, SEED_WORK_IDS);
  const pending = SEED_WORKS.filter((work) => !done.has(work.bangumiId)).map(
    (work) => work.bangumiId,
  );
  return ingestBatch(db, dependencies, pending);
}

/** TTL pass: re-ingest the stalest raw works, one at a time, capped per run. */
export async function runTtlJob(
  db: CatalogDb,
  dependencies: CronDependencies,
): Promise<CronJobResult> {
  const stale = await dependencies.listStaleWorkIds(db, TTL_BATCH_CAP);
  return ingestBatch(db, dependencies, stale.slice(0, TTL_BATCH_CAP));
}

/** Sequential per-work ingest; one failure never aborts the rest of the batch. */
async function ingestBatch(
  db: CatalogDb,
  dependencies: CronDependencies,
  workIds: readonly string[],
): Promise<CronJobResult> {
  let ingested = 0;
  for (const workId of workIds) {
    if (await ingestOne(db, dependencies, workId)) ingested++;
  }
  return { attempted: workIds.length, ingested, skipped: workIds.length - ingested };
}

/** One work's ingest, throwing-free — a failure counts as skipped, the batch continues. */
async function ingestOne(
  db: CatalogDb,
  dependencies: CronDependencies,
  workId: string,
): Promise<boolean> {
  try {
    return (await dependencies.ingestWork(db, workId)).status === "ingested";
  } catch (err) {
    console.error(`[cron] ingest failed for work ${workId}: ${String(err)}`);
    return false;
  }
}

export default {
  fetch: app.fetch,
  scheduled: createScheduledHandler(),
} satisfies ExportedHandler<Env>;
