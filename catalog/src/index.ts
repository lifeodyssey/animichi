import { Hono } from "hono";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { catalogRouter } from "./router";
import type { CatalogDb } from "./db/client";
import { serveImage } from "./media/img";

export interface Env {
  ENVIRONMENT?: string;
  /** Cloudflare Hyperdrive binding (prod): pooled Postgres connection string. */
  HYPERDRIVE?: { connectionString: string };
  /** Plain Postgres connection string (local/test fallback when no Hyperdrive). */
  DATABASE_URL?: string;
  /** R2 bucket for lazy-cached pilgrimage point photos (see media/img.ts). */
  MEDIA_BUCKET?: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) =>
  c.json({ status: "ok", service: "catalog", env: c.env?.ENVIRONMENT ?? "unknown" }),
);

// OpenAPIHandler (not RPCHandler): serves the router over PLAIN JSON matching
// packages/contract/openapi.json and the Python CatalogClient — request bodies
// are the raw input object and responses are the raw output object, NOT the
// RPCHandler `{json: ...}` envelope. Procedure `.route()` paths + this prefix
// map to the contract paths /catalog/{search,spots,nearby,route}.
const apiHandler = new OpenAPIHandler(catalogRouter);

/** The Postgres connection string for this request: Hyperdrive in prod, else DATABASE_URL. */
function connectionString(env?: Env): string | undefined {
  return env?.HYPERDRIVE?.connectionString ?? env?.DATABASE_URL;
}

// One Drizzle client (pool) per connection string, reused across requests.
// A fresh pool per request would leak connections; caching keeps a single pool
// per upstream and gives tests a handle to close (see closeDbPools).
const dbPools = new Map<string, CatalogDb>();

/**
 * The cached Drizzle client for `connStr`. The Drizzle client is `import`ed
 * lazily because it pulls in the Node `pg` driver, which the workerd test
 * bundler cannot statically bundle — keeping /healthz and the no-db 503 path
 * driver-free.
 */
async function dbFor(connStr: string): Promise<CatalogDb> {
  const cached = dbPools.get(connStr);
  if (cached) return cached;
  const { makeDb } = await import("./db/client");
  const db = makeDb(connStr);
  dbPools.set(connStr, db);
  return db;
}

/** Close every cached pool — for test teardown so sockets don't outlive the run. */
export async function closeDbPools(): Promise<void> {
  for (const db of dbPools.values()) {
    const client = (db as unknown as { $client?: { end(): Promise<void> } }).$client;
    if (client) await client.end().catch(() => {});
  }
  dbPools.clear();
}

// Lazy-R2 image serving for pilgrimage point photos. Registered BEFORE the
// /catalog/* oRPC middleware so Hono matches this concrete route first (the
// oRPC handler has no /img procedure and would otherwise 404/503). Topology:
// the main worker (worker/entry.js) intercepts top-level /img/* for the raw
// Anitabi CDN proxy and forwards /catalog/* to this Worker's CATALOG service
// binding — so the cached-photo route MUST live under /catalog/img/ to be
// reachable; a bare /img here would never be hit through the main worker.
// First hit pulls origin → stores in R2 → records media_assets → serves bytes;
// later hits serve from R2; a gone origin tombstones and serves a 404 fallback.
app.get("/catalog/img/:pointId", async (c) => {
  const connStr = connectionString(c.env);
  const bucket = c.env?.MEDIA_BUCKET;
  if (!connStr || !bucket) {
    return c.json({ error: "catalog media not configured" }, 503);
  }
  return serveImage(
    { db: await dbFor(connStr), bucket, fetchImpl: fetch },
    c.req.param("pointId"),
  );
});

// Mount the oRPC router under /catalog/* (search / spots / nearby / route).
// This matches the path convention in packages/contract (/catalog/<method>)
// and the Python client (CatalogClient._rpc). The Drizzle client is resolved
// per request from the configured connection string and injected as context.
app.use("/catalog/*", async (c, next) => {
  const connStr = connectionString(c.env);
  if (!connStr) {
    return c.json({ error: "catalog database not configured" }, 503);
  }
  const { matched, response } = await apiHandler.handle(c.req.raw, {
    prefix: "/catalog",
    // Inject the runtime's real `fetch` so the `ingest` method reaches upstream
    // Anitabi/Bangumi in prod; tests stub the global `fetch` to stay offline.
    context: { db: await dbFor(connStr), fetchImpl: fetch },
  });
  if (matched) {
    return c.newResponse(response.body, response);
  }
  await next();
});

export default app;
export { catalogRouter };
export type { CatalogRouter } from "./router";
