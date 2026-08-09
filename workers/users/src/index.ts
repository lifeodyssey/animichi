import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { Hono, type Context, type MiddlewareHandler, type Next } from "hono";
import type { JWTVerifyGetKey } from "jose";
import { verifyBearer } from "./auth/jwt";
import { makeDb as realMakeDb, type DbExecutor } from "./db/client";
import { usersRouter, type UsersContext } from "./router";

/** Users Worker bindings. Secrets are supplied outside wrangler vars. */
export interface Env {
  ENVIRONMENT?: string;
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string | SecretsStoreSecret;
  NEON_AUTH_JWKS_URL?: string;
}

/** Injectable boundaries used by workerd tests. */
export interface UsersAppDeps {
  getKey?: JWTVerifyGetKey;
  makeDb?: (connStr: string) => DbExecutor;
}

const dbPools = new Map<string, DbExecutor>();

/** In staging the DSN arrives as a Secrets Store binding (#912 PR2): `.get()`
 * resolves the string; the string branch keeps local dev and tests unchanged. */
async function connectionString(env: Env): Promise<string | undefined> {
  if (env.HYPERDRIVE?.connectionString) return env.HYPERDRIVE.connectionString;
  const url = env.DATABASE_URL;
  if (url == null) return undefined;
  return typeof url === "string" ? url : await url.get();
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

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function healthz(c: Context<{ Bindings: Env }>): Response {
  return c.json({ status: "ok", service: "users", env: c.env.ENVIRONMENT ?? "unknown" });
}

async function requestService(
  c: Context<{ Bindings: Env }>,
  deps: UsersAppDeps,
): Promise<{ db: DbExecutor; authUrl: string } | Response> {
  const authUrl = c.env.NEON_AUTH_JWKS_URL;
  if (!authUrl) return c.json({ error: "users auth not configured" }, 503);
  const connStr = await connectionString(c.env);
  if (!connStr) return c.json({ error: "users database not configured" }, 503);
  return { db: dbFor(connStr, deps.makeDb), authUrl };
}

async function requireUser(
  c: Context<{ Bindings: Env }>,
  deps: UsersAppDeps,
  authUrl: string,
): Promise<{ userId: string } | Response> {
  const auth = await verifyBearer(c.req.header("Authorization") ?? null, authUrl, deps.getKey);
  return auth ?? c.json(unauthorized, 401);
}

async function handleMatched(
  c: Context<{ Bindings: Env }>,
  next: Next,
  apiHandler: OpenAPIHandler<UsersContext>,
  context: { db: DbExecutor; userId: string },
): Promise<Response | undefined> {
  const { matched, response } = await apiHandler.handle(c.req.raw, { context });
  if (matched) return c.newResponse(response.body, response);
  await next();
}

interface UsersV1Service {
  apiHandler: OpenAPIHandler<UsersContext>;
  deps: UsersAppDeps;
}

async function guardUsersV1(
  service: UsersV1Service,
  c: Context<{ Bindings: Env }, string>, next: Next,
): Promise<Response | undefined> {
  const ready = await requestService(c, service.deps);
  if (isResponse(ready)) return ready;
  const user = await requireUser(c, service.deps, ready.authUrl);
  if (isResponse(user)) return user;
  return handleMatched(c, next, service.apiHandler, { db: ready.db, userId: user.userId });
}

/** Create an independently injectable Users Hono application. */
export function createUsersApp(deps: UsersAppDeps = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const apiHandler = new OpenAPIHandler(usersRouter);
  const usersV1Guard: MiddlewareHandler<{ Bindings: Env }, "/v1/users/*"> = async (c, next) =>
    guardUsersV1({ apiHandler, deps }, c, next);
  app.get("/healthz", healthz);
  app.use("/v1/users/*", usersV1Guard);
  return app;
}

export default createUsersApp();
export { usersRouter };
export type { UsersRouter } from "./router";
