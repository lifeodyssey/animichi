import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import { verifyBearer } from "./auth/jwt";
import { makeDb as realMakeDb, type DbExecutor } from "./db/client";
import { usersRouter } from "./router";

/** Users Worker bindings. Secrets are supplied outside wrangler vars. */
export interface Env {
  ENVIRONMENT?: string;
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
  NEON_AUTH_JWKS_URL?: string;
}

/** Injectable boundaries used by workerd tests. */
export interface UsersAppDeps {
  getKey?: JWTVerifyGetKey;
  makeDb?: (connStr: string) => DbExecutor;
}

const dbPools = new Map<string, DbExecutor>();

function connectionString(env: Env): string | undefined {
  return env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
}

function realDbFor(connStr: string): DbExecutor {
  const cached = dbPools.get(connStr);
  if (cached) return cached;
  const db = realMakeDb(connStr);
  dbPools.set(connStr, db);
  return db;
}

function dbFor(connStr: string, factory?: UsersAppDeps["makeDb"]): DbExecutor {
  return factory ? factory(connStr) : realDbFor(connStr);
}

/** Clear cached real Neon clients; neon-http owns no persistent sockets. */
export function closeDbPools(): void {
  dbPools.clear();
}

const unauthorized = {
  error: { code: "unauthorized", message: "Valid credentials required." },
};

/** Create an independently injectable Users Hono application. */
export function createUsersApp(deps: UsersAppDeps = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const apiHandler = new OpenAPIHandler(usersRouter);
  app.get("/healthz", (c) => c.json({
    status: "ok", service: "users", env: c.env.ENVIRONMENT ?? "unknown",
  }));
  app.use("/v1/users/*", async (c, next) => {
    const authUrl = c.env.NEON_AUTH_JWKS_URL;
    if (!authUrl) return c.json({ error: "users auth not configured" }, 503);
    const auth = await verifyBearer(
      c.req.header("Authorization") ?? null, authUrl, deps.getKey,
    );
    if (!auth) return c.json(unauthorized, 401);
    const connStr = connectionString(c.env);
    if (!connStr) return c.json({ error: "users database not configured" }, 503);
    const { matched, response } = await apiHandler.handle(c.req.raw, {
      context: { db: dbFor(connStr, deps.makeDb), userId: auth.userId },
    });
    if (matched) return c.newResponse(response.body, response);
    await next();
  });
  return app;
}

export default createUsersApp();
export { usersRouter };
export type { UsersRouter } from "./router";
