import { OpenAPIHandler } from "@orpc/openapi/fetch";
import type { FetchHandleResult } from "@orpc/server/fetch";
import { Hono, type Context, type MiddlewareHandler, type Next } from "hono";
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENCY_KEY_MAX_LENGTH, USERS_ERROR_DEFS } from "@animichi/contract";
import {
  AUTHORIZATION_HEADER, REQUEST_ID_HEADER, USER_IDENTITY_HEADER, USER_TYPE_HEADER, acceptedRequestId,
} from "@animichi/contract/internal-binding";
import type { UsersPrisma } from "./db/prisma";
import { connectedUsersRouter, type UsersRequestContext } from "./request-connection";
import { usersRouter, type UsersContext } from "./router";

/** Users Worker bindings. Secrets are supplied outside wrangler vars. */
export interface Env {
  ENVIRONMENT?: string;
  DATABASE_URL?: string | SecretsStoreSecret;
}

/** Injectable boundaries used by workerd tests. */
export interface UsersAppDeps {
  /** Replace this request's Prisma access — a test seam, never a deployment knob. */
  makePrisma?: (connStr: string) => UsersPrisma;
}

/** In staging the DSN arrives as a Secrets Store binding (#912 PR2): `.get()`
 * resolves the string; the string branch keeps local dev and tests unchanged. */
async function connectionString(env: Env): Promise<string | undefined> {
  const url = env.DATABASE_URL;
  if (url == null) return undefined;
  return typeof url === "string" ? url : await url.get();
}

const unauthorized = {
  error: { code: "unauthorized", message: "Valid credentials required." },
};

const KEY_INVALID = USERS_ERROR_DEFS.IDEMPOTENCY_KEY_INVALID;

/** Typed 400 envelope for an over-long Idempotency-Key (abuse-bounded #1011),
 * with the status and message the contract's registry gives the code. */
const idempotencyKeyInvalid = {
  defined: true, code: "IDEMPOTENCY_KEY_INVALID", status: KEY_INVALID.status,
  message: KEY_INVALID.message, data: {},
};

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function healthz(c: Context<{ Bindings: Env }>): Response {
  return c.json({ status: "ok", service: "users", env: c.env.ENVIRONMENT ?? "unknown" });
}

/**
 * The internal-identity boundary (AUTH-2 #950): the users service trusts ONLY
 * the edge's verified identity, which arrives over the USERS service binding
 * as `X-User-Id` (the edge stripped `Authorization` and any caller-supplied
 * identity headers first — see workers/api/gateway/forward.ts forwardUsers).
 *
 * A request that still carries `Authorization` is raw bearer access: it did not
 * come from the edge (which deletes the header), so the token is unverified and
 * the request is flat-401. There is no anonymous path here, so a missing
 * identity is also 401.
 */
function edgeIdentity(c: Context<{ Bindings: Env }>): string | null {
  if (c.req.header(AUTHORIZATION_HEADER) != null) return null;
  if (c.req.header(USER_TYPE_HEADER) !== "human") return null;
  const userId = c.req.header(USER_IDENTITY_HEADER);
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}

/** The identity, retry-safe key and gateway request ID this request is admitted with. */
interface Admission { userId: string; idempotencyKey?: string; requestId?: string }

/** Admission, or the Response that refuses the request before any work. */
function admit(c: Context<{ Bindings: Env }>): Admission | Response {
  const userId = edgeIdentity(c);
  if (userId === null) return c.json(unauthorized, 401);
  // The retry-safe create key, forwarded unchanged from the edge; the save
  // handler only honors it for a create (no id). Reject an over-long token
  // here, before dispatch, so the ledger never sees an unbounded PK key value.
  const idempotencyKey = c.req.header(IDEMPOTENCY_KEY_HEADER);
  if (idempotencyKey !== undefined && idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return c.json(idempotencyKeyInvalid, KEY_INVALID.status);
  }
  // The gateway's request ID rides the same binding as the identity above.
  const admitted = { userId, requestId: acceptedRequestId(c.req.header(REQUEST_ID_HEADER)) };
  return idempotencyKey === undefined ? admitted : { ...admitted, idempotencyKey };
}

/** The matched procedure's response; a path no procedure serves falls through to Hono's 404. */
async function respond(
  c: Context<{ Bindings: Env }>, next: Next, handled: FetchHandleResult,
): Promise<Response | undefined> {
  if (handled.matched) return c.newResponse(handled.response.body, handled.response);
  await next();
}

interface UsersV1Service {
  /** Opens each request's connection once the input has passed validation (`./request-connection`). */
  apiHandler: OpenAPIHandler<UsersRequestContext>;
  /** Serves the Prisma a test injects through `deps.makePrisma`, which needs no connection. */
  injectedHandler: OpenAPIHandler<UsersContext>;
  deps: UsersAppDeps;
}

async function guardUsersV1(
  service: UsersV1Service,
  c: Context<{ Bindings: Env }, string>, next: Next,
): Promise<Response | undefined> {
  const connStr = await connectionString(c.env);
  if (!connStr) return c.json({ error: "users database not configured" }, 503);
  const admission = admit(c);
  if (isResponse(admission)) return admission;
  const injected = service.deps.makePrisma?.(connStr);
  const handled = injected === undefined
    ? await service.apiHandler.handle(c.req.raw, { context: { databaseUrl: connStr, ...admission } })
    : await service.injectedHandler.handle(c.req.raw, { context: { prisma: injected, ...admission } });
  return respond(c, next, handled);
}

/** Create an independently injectable Users Hono application. */
export function createUsersApp(deps: UsersAppDeps = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const apiHandler = new OpenAPIHandler(connectedUsersRouter);
  const injectedHandler = new OpenAPIHandler(usersRouter);
  const usersV1Guard: MiddlewareHandler<{ Bindings: Env }, "/v1/users/*"> = async (c, next) =>
    guardUsersV1({ apiHandler, injectedHandler, deps }, c, next);
  app.get("/healthz", healthz);
  app.use("/v1/users/*", usersV1Guard);
  return app;
}

export default createUsersApp();
export { usersRouter };
export type { UsersRouter } from "./router";
