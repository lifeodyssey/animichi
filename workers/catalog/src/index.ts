import { Hono } from "hono";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { catalogRouter } from "./router";
import type { CatalogDb, NeonSql } from "./db/client";
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

const app = new Hono<{ Bindings: Env }>();

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

export default app;
export { catalogRouter };
export type { CatalogRouter } from "./router";
