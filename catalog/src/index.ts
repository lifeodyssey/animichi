import { Hono } from "hono";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { catalogRouter } from "./router";
import type { CatalogDb } from "./db/client";

export interface Env {
  ENVIRONMENT?: string;
  /** Cloudflare Hyperdrive binding (prod): pooled Postgres connection string. */
  HYPERDRIVE?: { connectionString: string };
  /** Plain Postgres connection string (local/test fallback when no Hyperdrive). */
  DATABASE_URL?: string;
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
    context: { db: await dbFor(connStr) },
  });
  if (matched) {
    return c.newResponse(response.body, response);
  }
  await next();
});

export default app;
export { catalogRouter };
export type { CatalogRouter } from "./router";
