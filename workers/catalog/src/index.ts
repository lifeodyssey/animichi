import { Hono, type Context } from "hono";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { catalogRouter } from "./router";
import type { CatalogDb, NeonSql } from "./db/client";
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

const apiHandler = new OpenAPIHandler(catalogRouter);

/** The Postgres connection string for this request: Hyperdrive in prod, else DATABASE_URL. */
function connectionString(env?: Env): string | undefined {
  return env?.HYPERDRIVE?.connectionString ?? env?.DATABASE_URL;
}

function waitUntilFor(
  c: Context<{ Bindings: Env }>,
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
export async function closeDbPools(): Promise<void> {
  dbPools.clear();
}

app.get("/catalog/img/:pointId", async (c) => {
  const connStr = connectionString(c.env);
  const bucket = c.env?.MEDIA_BUCKET;
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
    prefix: "/catalog",
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
