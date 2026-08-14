import { WorkerEntrypoint } from "cloudflare:workers";
import { Hono } from "hono";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { catalogRouter } from "./router";
import { catalogIngestBangumi } from "./ingest/ingest-bangumi";
import type { IngestResult } from "./ingest/ingest-bangumi";
import { serveImage } from "./media/img";
import { mountSnapshotRoutes } from "./api/snapshot";
import { r2SnapshotSource, type SnapshotReadService, type SnapshotSource } from "./import/snapshot-source";
import { mountAdminRoutes } from "./import/admin-routes";
import { connectionString, dbFor } from "./db/connections";
import { createScheduledHandler } from "./scheduled/ingest-schedule";

export interface Env {
  ENVIRONMENT?: string;
  /** Optional pooled connection binding when a deployment provides one. */
  HYPERDRIVE?: { connectionString: string };
  /** Neon Postgres connection string used by the current catalog deployment. */
  DATABASE_URL?: string | SecretsStoreSecret;
  /** R2 bucket for lazy-cached pilgrimage point photos (see media/img.ts). */
  MEDIA_BUCKET?: R2Bucket;
  /** R2 bucket for immutable public catalog snapshots (issue #1012, see publish/). */
  SNAPSHOT_BUCKET?: R2Bucket;
  /** Operational secret guarding POST /catalog/snapshot/rollback (401 when wrong). */
  SNAPSHOT_ADMIN_TOKEN?: string;
  /** Private read-only binding to PRODUCTION's catalog Worker (staging import, AC2). */
  PROD_SNAPSHOT?: SnapshotReadService;
  /** Operational secret guarding POST /catalog/admin/* commands (AC5, 401 when wrong). */
  CATALOG_ADMIN_TOKEN?: string;
}

export const app = new Hono<{ Bindings: Env }>();

/** Resolve the admin command DB from the env, else null (503, fail-closed). */
async function adminDbResolver(env: Env): Promise<import("./db/client").CatalogDb | null> {
  const connStr = await connectionString(env);
  if (!connStr) return null;
  return (await dbFor(connStr)).db;
}

mountSnapshotRoutes(app);
mountAdminRoutes(app, undefined, undefined, adminDbResolver);

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

/** Internal-only ingest door via Cloudflare service binding (#540). */
export class IngestEntrypoint extends WorkerEntrypoint<Env> {
  async ingestBangumi(bangumiId: string): Promise<IngestResult> {
    const connStr = await connectionString(this.env);
    if (!connStr) throw new Error("catalog database not configured");
    const { db } = await dbFor(connStr);
    return catalogIngestBangumi(db).ingest(bangumiId);
  }
}

/**
 * Read-only snapshot service for STAGING's daily import (issue #1016, AC2).
 *
 * Reads the CURRENT deployed snapshot's manifest + objects from this Worker's
 * own SNAPSHOT_BUCKET. It exposes no write path, no production credential, and
 * no database access — staging calls it through a private service binding and
 * never holds production object-store credentials.
 */
export class SnapshotReadEntrypoint extends WorkerEntrypoint<Env> implements SnapshotReadService {
  private source(): SnapshotSource | null {
    return this.env.SNAPSHOT_BUCKET ? r2SnapshotSource(this.env.SNAPSHOT_BUCKET) : null;
  }

  async currentManifest() {
    const source = this.source();
    return source === null ? null : source.currentManifest();
  }

  async readObject(key: string) {
    const source = this.source();
    return source === null ? null : source.readObject(key);
  }
}

// Scheduled-ingestion runtime (cron dispatcher, per-env guard, seed/TTL/daily
// jobs, staging import) lives in ./scheduled/ingest-schedule.ts and is
// re-exported here so the Worker's public symbol surface is unchanged.
export * from "./scheduled/ingest-schedule";

// Test-teardown helper kept on the entry surface; it lives in ./db/connections.
export { closeDbPools } from "./db/connections";

export default {
  fetch: app.fetch,
  scheduled: createScheduledHandler(),
} satisfies ExportedHandler<Env>;
